// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { replay, ReplayError } from "./projection.js";
import { ConcurrencyError } from "./log.js";
import { PostgresMark, migrate, MARK_EVENTS_TABLE } from "./postgres.js";

const url = process.env.MARROW_TEST_DATABASE_URL;

describe.skipIf(!url)("PostgresMark", () => {
  let pool: Pool;
  let mark: PostgresMark;

  beforeAll(() => {
    pool = new Pool({ connectionString: url });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${MARK_EVENTS_TABLE} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS schema_migrations CASCADE`);
    await migrate(pool);
    mark = new PostgresMark(pool);
  });

  it("appends events and reads them back per object, in order, with monotonic seq", async () => {
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await mark.append("obj-1", { type: "StateChanged", state: "open" });

    const events = await mark.read("obj-1");

    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.map((e) => e.event.type)).toEqual(["ObjectCreated", "StateChanged"]);
    expect(events[0]!.globalSeq).toBeLessThan(events[1]!.globalSeq);
  });

  it("load equals replay(read) — state is nothing but a fold of the events", async () => {
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await mark.append("obj-1", { type: "AttributeSet", key: "priority", value: "high" });
    await mark.append("obj-1", { type: "StateChanged", state: "resolved" });
    await mark.append("obj-1", { type: "NoteAdded", text: "done" });

    const read = await mark.read("obj-1");
    const loaded = await mark.load("obj-1");

    expect(loaded).toEqual(replay(read.map((r) => r.event)));
    expect(loaded).toEqual({
      id: "obj-1",
      objectType: "ticket",
      attributes: { priority: "high" },
      state: "resolved",
      notes: ["done"],
      version: 4,
    });
  });

  it("returns null from load when the object has no events", async () => {
    expect(await mark.load("missing")).toBeNull();
  });

  it("preserves glass-box metadata across a round-trip", async () => {
    await mark.append(
      "obj-1",
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { metadata: { actor: "agent:cortex", reason: "classified", confidence: 0.9 } },
    );
    const [recorded] = await mark.read("obj-1");
    expect(recorded!.metadata).toEqual({ actor: "agent:cortex", reason: "classified", confidence: 0.9 });
  });

  it("enforces optimistic concurrency via expectedVersion", async () => {
    await mark.append(
      "obj-1",
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { expectedVersion: 0 },
    );

    await expect(
      mark.append("obj-1", { type: "StateChanged", state: "open" }, { expectedVersion: 0 }),
    ).rejects.toThrow(ConcurrencyError);

    const ok = await mark.append(
      "obj-1",
      { type: "StateChanged", state: "open" },
      { expectedVersion: 1 },
    );
    expect(ok.seq).toBe(2);
  });

  it("rejects an event the projection cannot legally apply (mutated before created)", async () => {
    await expect(
      mark.append("obj-1", { type: "StateChanged", state: "open" }),
    ).rejects.toThrow(ReplayError);
  });

  it("rejects re-creating an existing object", async () => {
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await expect(
      mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" }),
    ).rejects.toThrow(ReplayError);
  });

  it("is append-only at the database: UPDATE, DELETE and TRUNCATE are rejected by a trigger", async () => {
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });

    await expect(
      pool.query(`UPDATE ${MARK_EVENTS_TABLE} SET type = 'tampered'`),
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(`DELETE FROM ${MARK_EVENTS_TABLE}`),
    ).rejects.toThrow(/append-only/i);
    await expect(
      pool.query(`TRUNCATE ${MARK_EVENTS_TABLE}`),
    ).rejects.toThrow(/append-only/i);
  });

  it("stamps the current schema version on append and round-trips it", async () => {
    const recorded = await mark.append("v-1", {
      type: "ObjectCreated",
      id: "v-1",
      objectType: "ticket",
    });
    expect(recorded.schemaVersion).toBe(1);

    const [read] = await mark.read("v-1");
    expect(read!.schemaVersion).toBe(1);
  });

  it("rejects a stored event whose schema version is newer than current (from the future)", async () => {
    await pool.query(
      `INSERT INTO ${MARK_EVENTS_TABLE} (object_id, seq, type, payload, metadata, occurred_at, schema_version)
       VALUES ($1, 1, 'ObjectCreated', $2, $3, now(), $4)`,
      ["future-1", { id: "future-1", objectType: "ticket" }, { actor: "system" }, 999],
    );

    await expect(mark.read("future-1")).rejects.toThrow();
  });

  it("rejects a stored event whose payload does not match its type (schema drift)", async () => {
    // A malformed row written straight to the table — a raw INSERT is allowed
    // (only UPDATE/DELETE/TRUNCATE are blocked); this simulates schema drift or
    // a buggy writer. An ObjectCreated payload is missing its required `id`.
    await pool.query(
      `INSERT INTO ${MARK_EVENTS_TABLE} (object_id, seq, type, payload, metadata, occurred_at)
       VALUES ($1, 1, 'ObjectCreated', $2, $3, now())`,
      ["drift-1", { objectType: "ticket" }, { actor: "system" }],
    );

    await expect(mark.read("drift-1")).rejects.toThrow();
    await expect(mark.load("drift-1")).rejects.toThrow();
  });

  it("rejects a stored event whose glass-box metadata is missing its actor", async () => {
    // The audit envelope gets the same boundary strictness as the payload:
    // metadata without an actor cannot be trusted as a reconstruction of "why".
    await pool.query(
      `INSERT INTO ${MARK_EVENTS_TABLE} (object_id, seq, type, payload, metadata, occurred_at)
       VALUES ($1, 1, 'ObjectCreated', $2, $3, now())`,
      ["meta-1", { id: "meta-1", objectType: "ticket" }, {}],
    );

    await expect(mark.read("meta-1")).rejects.toThrow();
  });
});
