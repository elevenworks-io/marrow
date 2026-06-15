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

  it("listObjects returns the current state of every object of a type, in creation order", async () => {
    await mark.append("t1", { type: "ObjectCreated", id: "t1", objectType: "ticket" });
    await mark.append("i1", { type: "ObjectCreated", id: "i1", objectType: "invoice" });
    await mark.append("t2", { type: "ObjectCreated", id: "t2", objectType: "ticket" });
    await mark.append("t1", { type: "StateChanged", state: "open" });

    const tickets = await mark.listObjects("ticket");

    expect(tickets.map((o) => o.id)).toEqual(["t1", "t2"]);
    expect(tickets[0]!.state).toBe("open");
    expect(await mark.listObjects("invoice")).toHaveLength(1);
    expect(await mark.listObjects("nope")).toHaveLength(0);
  });

  it("deduplicates appends that carry the same idempotency key", async () => {
    const first = await mark.append(
      "a",
      { type: "ObjectCreated", id: "a", objectType: "ticket" },
      { idempotencyKey: "k1" },
    );
    const retry = await mark.append(
      "a",
      { type: "ObjectCreated", id: "a", objectType: "ticket" },
      { idempotencyKey: "k1" },
    );

    expect(retry.eventId).toBe(first.eventId);
    expect(retry.globalSeq).toBe(first.globalSeq);
    expect(await mark.read("a")).toHaveLength(1);
  });

  it("scopes idempotency keys per object — the same key on different objects is two distinct events", async () => {
    const [r1, r2] = await Promise.all([
      mark.append("ra", { type: "ObjectCreated", id: "ra", objectType: "ticket" }, { idempotencyKey: "k" }),
      mark.append("rb", { type: "ObjectCreated", id: "rb", objectType: "ticket" }, { idempotencyKey: "k" }),
    ]);

    expect(r1.eventId).not.toBe(r2.eventId);
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM ${MARK_EVENTS_TABLE} WHERE idempotency_key = 'k'`,
    );
    expect(rows[0]!.n).toBe(2);
  });

  it("deduplicates a concurrent retry to the same object", async () => {
    const [r1, r2] = await Promise.all([
      mark.append("rc", { type: "ObjectCreated", id: "rc", objectType: "ticket" }, { idempotencyKey: "k" }),
      mark.append("rc", { type: "ObjectCreated", id: "rc", objectType: "ticket" }, { idempotencyKey: "k" }),
    ]);

    expect(r1.eventId).toBe(r2.eventId);
    expect(await mark.read("rc")).toHaveLength(1);
  });

  it("readCorrelation finds a pre-lineage row whose correlation_id is NULL (read as its own id)", async () => {
    await pool.query(
      `INSERT INTO ${MARK_EVENTS_TABLE} (object_id, seq, type, payload, metadata, occurred_at, event_id)
       VALUES ($1, 1, 'ObjectCreated', $2, $3, now(), $4)`,
      ["legacy-1", { id: "legacy-1", objectType: "ticket" }, { actor: "system" }, "legacy-event-id"],
    );

    const chain = await mark.readCorrelation("legacy-event-id");
    expect(chain).toHaveLength(1);
    expect(chain[0]!.eventId).toBe("legacy-event-id");
    expect(chain[0]!.correlationId).toBe("legacy-event-id");
  });

  it("records correlation/causation lineage and reconstructs a case across objects", async () => {
    const root = await mark.append("a", { type: "ObjectCreated", id: "a", objectType: "ticket" });
    expect(root.correlationId).toBe(root.eventId);
    expect(root.causationId).toBeNull();

    const other = await mark.append(
      "b",
      { type: "ObjectCreated", id: "b", objectType: "note" },
      { causedBy: root },
    );
    await mark.append("a", { type: "NoteAdded", text: "linked" }, { causedBy: other });

    expect(other.causationId).toBe(root.eventId);
    expect(other.correlationId).toBe(root.correlationId);

    const chain = await mark.readCorrelation(root.correlationId);
    expect(chain.map((e) => e.objectId)).toEqual(["a", "b", "a"]);
    expect(chain.every((e) => e.correlationId === root.correlationId)).toBe(true);
  });

  it("round-trips the agent decision chain and load equals replay(read)", async () => {
    await mark.append("c1", { type: "ObjectCreated", id: "c1", objectType: "complaint" });
    await mark.append("c1", { type: "AttributeSet", key: "text", value: "late delivery" });
    const proposed = await mark.append(
      "c1",
      { type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 2 },
      { metadata: { actor: "cortex", confidence: 0.9 } },
    );
    await mark.append("c1", {
      type: "ConfidenceAssessed",
      confidence: 0.9,
      threshold: 0.8,
      tier: "T3",
    });
    await mark.append("c1", { type: "Acted", draftRef: proposed.eventId });

    const read = await mark.read("c1");
    expect(read.map((e) => e.event.type)).toEqual([
      "ObjectCreated",
      "AttributeSet",
      "DecisionProposed",
      "ConfidenceAssessed",
      "Acted",
    ]);

    // ObjectState stays field-clean; version counts every event in the stream.
    const loaded = await mark.load("c1");
    expect(loaded).toEqual(replay(read.map((r) => r.event)));
    expect(loaded?.version).toBe(5);
    expect(loaded?.attributes).toEqual({ text: "late delivery" });

    // Glass-box confidence survives the round-trip.
    const proposedRead = read.find((e) => e.event.type === "DecisionProposed");
    expect(proposedRead?.metadata.confidence).toBe(0.9);
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
