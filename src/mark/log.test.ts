// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type { RecordedEvent } from "./event.js";
import { InMemoryMark, ConcurrencyError } from "./log.js";
import { replay, ReplayError } from "./projection.js";

describe("InMemoryMark", () => {
  it("appends events and reads them back per object, in order, with monotonic seq from 1", async () => {
    const mark = new InMemoryMark();
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await mark.append("obj-1", { type: "StateChanged", state: "open" });

    const events = await mark.read("obj-1");

    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.map((e) => e.event.type)).toEqual(["ObjectCreated", "StateChanged"]);
  });

  it("keeps per-object seq isolated while globalSeq orders across all objects", async () => {
    const mark = new InMemoryMark();
    const a1 = await mark.append("a", { type: "ObjectCreated", id: "a", objectType: "ticket" });
    const b1 = await mark.append("b", { type: "ObjectCreated", id: "b", objectType: "invoice" });
    const a2 = await mark.append("a", { type: "StateChanged", state: "open" });

    expect([a1.seq, b1.seq, a2.seq]).toEqual([1, 1, 2]);
    expect([a1.globalSeq, b1.globalSeq, a2.globalSeq]).toEqual([1, 2, 3]);
  });

  it("load() projects current state; null when the object has no events", async () => {
    const mark = new InMemoryMark();
    expect(await mark.load("missing")).toBeNull();

    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await mark.append("obj-1", { type: "AttributeSet", key: "priority", value: "high" });
    await mark.append("obj-1", { type: "StateChanged", state: "open" });

    expect(await mark.load("obj-1")).toEqual({
      id: "obj-1",
      objectType: "ticket",
      attributes: { priority: "high" },
      state: "open",
      notes: [],
      version: 3,
    });
  });

  it("load equals replay(read) — state is nothing but a fold of the events", async () => {
    const mark = new InMemoryMark();
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await mark.append("obj-1", { type: "AttributeSet", key: "subject", value: "Burst pipe" });
    await mark.append("obj-1", { type: "StateChanged", state: "resolved" });
    await mark.append("obj-1", { type: "NoteAdded", text: "done" });

    const read = await mark.read("obj-1");
    const loaded = await mark.load("obj-1");

    expect(loaded).toEqual(replay(read.map((r) => r.event)));
  });

  it("is append-only: mutating the array returned by read does not touch the log", async () => {
    const mark = new InMemoryMark();
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });

    const snapshot = (await mark.read("obj-1")) as RecordedEvent[];
    snapshot.length = 0;

    expect(await mark.read("obj-1")).toHaveLength(1);
  });

  it("rejects an ObjectCreated whose id does not match the log key", async () => {
    const mark = new InMemoryMark();
    await expect(
      mark.append("obj-1", { type: "ObjectCreated", id: "other", objectType: "ticket" }),
    ).rejects.toThrow();
  });

  it("rejects an event that the projection cannot legally apply (mutated before created)", async () => {
    const mark = new InMemoryMark();
    await expect(
      mark.append("obj-1", { type: "StateChanged", state: "open" }),
    ).rejects.toThrow(ReplayError);
  });

  it("rejects re-creating an existing object", async () => {
    const mark = new InMemoryMark();
    await mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" });
    await expect(
      mark.append("obj-1", { type: "ObjectCreated", id: "obj-1", objectType: "ticket" }),
    ).rejects.toThrow(ReplayError);
  });

  it("enforces optimistic concurrency via expectedVersion", async () => {
    const mark = new InMemoryMark();
    // expectedVersion 0 means "I expect this object not to exist yet".
    await mark.append(
      "obj-1",
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { expectedVersion: 0 },
    );

    // A stale writer thinks the object is still at version 0.
    await expect(
      mark.append(
        "obj-1",
        { type: "StateChanged", state: "open" },
        { expectedVersion: 0 },
      ),
    ).rejects.toThrow(ConcurrencyError);

    // The up-to-date writer (version 1) succeeds.
    const ok = await mark.append(
      "obj-1",
      { type: "StateChanged", state: "open" },
      { expectedVersion: 1 },
    );
    expect(ok.seq).toBe(2);
  });

  it("deduplicates appends that carry the same idempotency key", async () => {
    const mark = new InMemoryMark();
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

  it("treats different idempotency keys as distinct appends", async () => {
    const mark = new InMemoryMark();
    await mark.append(
      "a",
      { type: "ObjectCreated", id: "a", objectType: "ticket" },
      { idempotencyKey: "k1" },
    );
    await mark.append("a", { type: "NoteAdded", text: "x" }, { idempotencyKey: "k2" });

    expect(await mark.read("a")).toHaveLength(2);
  });

  it("a root event is its own correlation and has no causation", async () => {
    const mark = new InMemoryMark();
    const root = await mark.append("a", { type: "ObjectCreated", id: "a", objectType: "ticket" });

    expect(typeof root.eventId).toBe("string");
    expect(root.eventId.length).toBeGreaterThan(0);
    expect(root.correlationId).toBe(root.eventId);
    expect(root.causationId).toBeNull();
  });

  it("a caused event inherits the correlation and points causation at its cause", async () => {
    const mark = new InMemoryMark();
    const root = await mark.append("a", { type: "ObjectCreated", id: "a", objectType: "ticket" });
    const child = await mark.append(
      "a",
      { type: "StateChanged", state: "open" },
      { causedBy: root },
    );

    expect(child.causationId).toBe(root.eventId);
    expect(child.correlationId).toBe(root.correlationId);
    expect(child.eventId).not.toBe(root.eventId);
  });

  it("readCorrelation returns every event of a case across objects, in global order", async () => {
    const mark = new InMemoryMark();
    const root = await mark.append("a", { type: "ObjectCreated", id: "a", objectType: "ticket" });
    const other = await mark.append(
      "b",
      { type: "ObjectCreated", id: "b", objectType: "note" },
      { causedBy: root },
    );
    await mark.append("a", { type: "NoteAdded", text: "linked" }, { causedBy: other });

    const chain = await mark.readCorrelation(root.correlationId);

    expect(chain.map((e) => e.objectId)).toEqual(["a", "b", "a"]);
    expect(chain.map((e) => e.globalSeq)).toEqual([...chain.map((e) => e.globalSeq)].sort((x, y) => x - y));
    expect(chain.every((e) => e.correlationId === root.correlationId)).toBe(true);
  });

  it("stamps the current schema version on recorded events", async () => {
    const mark = new InMemoryMark();
    const recorded = await mark.append("obj-1", {
      type: "ObjectCreated",
      id: "obj-1",
      objectType: "ticket",
    });
    expect(recorded.schemaVersion).toBe(1);
  });

  it("records glass-box metadata on the envelope", async () => {
    const mark = new InMemoryMark();
    const recorded = await mark.append(
      "obj-1",
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { metadata: { actor: "agent:cortex", reason: "intake classified as ticket", confidence: 0.92 } },
    );

    expect(recorded.metadata).toEqual({
      actor: "agent:cortex",
      reason: "intake classified as ticket",
      confidence: 0.92,
    });
  });
});
