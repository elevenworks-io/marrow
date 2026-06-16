// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { replayTrace, summaryOf } from "./trace.js";

function rec(o: Partial<RecordedEvent> & { eventId: string; event: MarkEvent }): RecordedEvent {
  return {
    eventId: o.eventId,
    correlationId: o.correlationId ?? o.eventId,
    causationId: o.causationId ?? null,
    globalSeq: o.globalSeq ?? 0,
    objectId: o.objectId ?? "obj",
    seq: o.seq ?? 1,
    schemaVersion: o.schemaVersion ?? 1,
    event: o.event,
    metadata: o.metadata ?? { actor: "test" },
    occurredAt: o.occurredAt ?? "2026-06-15T00:00:00.000Z",
    recordedAt: o.recordedAt ?? "2026-06-15T00:00:00.000Z",
  };
}

describe("summaryOf", () => {
  it("renders a one-line essence per event type", () => {
    expect(summaryOf({ type: "ObjectCreated", id: "x", objectType: "complaint" })).toContain("complaint");
    expect(summaryOf({ type: "AttributeSet", key: "text", value: "hi" })).toContain("text");
    expect(summaryOf({ type: "StateChanged", state: "open" })).toContain("open");
    expect(summaryOf({ type: "NoteAdded", text: "note" })).toContain("note");
    expect(
      summaryOf({ type: "DecisionProposed", draft: "Sorry!", perceivedObjectId: "c1", perceivedSeq: 2 }),
    ).toContain("Sorry!");
    expect(summaryOf({ type: "ConfidenceAssessed", confidence: 0.72, threshold: 0.8, tier: "T3" })).toContain("0.72");
    expect(summaryOf({ type: "Acted", draftRef: "abcdef123456" })).toContain("abcdef12");
    expect(summaryOf({ type: "Escalated", reason: "too low" })).toContain("too low");
    expect(summaryOf({ type: "OutcomeObserved", wasCorrect: true, evidence: "human ok" })).toContain("human ok");
  });
});

describe("replayTrace", () => {
  it("threads a linear decision chain into one branch", () => {
    const events = [
      rec({ eventId: "p", globalSeq: 1, event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
      rec({ eventId: "a", globalSeq: 2, correlationId: "p", causationId: "p", event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "x", globalSeq: 3, correlationId: "p", causationId: "a", event: { type: "Acted", draftRef: "p" } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    const root = forest[0]!;
    expect(root.eventId).toBe("p");
    expect(root.children.map((c) => c.eventId)).toEqual(["a"]);
    expect(root.children[0]!.children.map((c) => c.eventId)).toEqual(["x"]);
  });

  it("builds a shallow star for ObjectCreated → N attributes", () => {
    const events = [
      rec({ eventId: "o", globalSeq: 1, event: { type: "ObjectCreated", id: "obj", objectType: "complaint" } }),
      rec({ eventId: "k1", globalSeq: 2, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "text", value: "hi" } }),
      rec({ eventId: "k2", globalSeq: 3, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "lang", value: "de" } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.children.map((c) => c.eventId)).toEqual(["k1", "k2"]);
  });

  it("yields a forest of roots for a creation star + a separate decision chain", () => {
    const events = [
      rec({ eventId: "o", globalSeq: 1, event: { type: "ObjectCreated", id: "obj", objectType: "complaint" } }),
      rec({ eventId: "k1", globalSeq: 2, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "text", value: "hi" } }),
      rec({ eventId: "p", globalSeq: 3, event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
    ];
    const forest = replayTrace(events);
    expect(forest.map((r) => r.eventId)).toEqual(["o", "p"]);
  });

  it("is a function of the event array alone (shuffle → identical forest)", () => {
    const events = [
      rec({ eventId: "p", globalSeq: 1, event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
      rec({ eventId: "a", globalSeq: 2, correlationId: "p", causationId: "p", event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "x", globalSeq: 3, correlationId: "p", causationId: "a", event: { type: "Acted", draftRef: "p" } }),
    ];
    expect(replayTrace([events[2]!, events[0]!, events[1]!])).toEqual(replayTrace(events));
  });

  it("merges a cross-object causal edge into one tree (objectId-agnostic)", () => {
    const events = [
      rec({ eventId: "src", globalSeq: 1, objectId: "A", event: { type: "NoteAdded", text: "trigger" } }),
      rec({ eventId: "dec", globalSeq: 2, objectId: "B", correlationId: "src", causationId: "src", event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "A", perceivedSeq: 1 } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.children.map((c) => c.eventId)).toEqual(["dec"]);
  });

  it("flags a dangling causationId as an externalCause root (forward-looking)", () => {
    const events = [
      rec({ eventId: "dec", globalSeq: 2, correlationId: "missing", causationId: "missing", event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0]!.externalCause).toBe("missing");
  });

  it("throws on a duplicate eventId (corruption signal)", () => {
    const dup = [
      rec({ eventId: "d", globalSeq: 1, event: { type: "NoteAdded", text: "a" } }),
      rec({ eventId: "d", globalSeq: 2, event: { type: "NoteAdded", text: "b" } }),
    ];
    expect(() => replayTrace(dup)).toThrow(/duplicate eventId/);
  });

  it("surfaces confidence and tier on a ConfidenceAssessed node, undefined elsewhere", () => {
    const events = [
      rec({ eventId: "a", globalSeq: 1, event: { type: "ConfidenceAssessed", confidence: 0.72, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "n", globalSeq: 2, event: { type: "NoteAdded", text: "x" } }),
    ];
    const forest = replayTrace(events);
    const assessed = forest[0]!;
    const note = forest[1]!;
    expect(assessed.confidence).toBe(0.72);
    expect(assessed.tier).toBe("T3");
    expect(note.confidence).toBeUndefined();
    expect(note.tier).toBeUndefined();
  });

  it("handles degenerate inputs", () => {
    expect(replayTrace([])).toEqual([]);
    expect(replayTrace([rec({ eventId: "s", event: { type: "NoteAdded", text: "x" } })])).toHaveLength(1);
  });
});
