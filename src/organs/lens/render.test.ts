// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { replayTrace } from "./trace.js";
import { summarizeEpisodes } from "./episode.js";
import { renderTrace } from "./render.js";

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

const fullComplaint = (status: "acted" | "escalated"): RecordedEvent[] => {
  const conf = status === "acted" ? 0.9 : 0.4;
  const last: MarkEvent = status === "acted" ? { type: "Acted", draftRef: "p" } : { type: "Escalated", reason: "confidence 0.4 below threshold 0.8" };
  return [
    rec({ eventId: "o", globalSeq: 1, event: { type: "ObjectCreated", id: "c1", objectType: "complaint" } }),
    rec({ eventId: "k", globalSeq: 2, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "text", value: "order never arrived" } }),
    rec({ eventId: "p", globalSeq: 3, correlationId: "p", event: { type: "DecisionProposed", draft: "We're sorry for the delay.", perceivedObjectId: "c1", perceivedSeq: 2 } }),
    rec({ eventId: "a", globalSeq: 4, correlationId: "p", causationId: "p", event: { type: "ConfidenceAssessed", confidence: conf, threshold: 0.8, tier: "T3" } }),
    rec({ eventId: "x", globalSeq: 5, correlationId: "p", causationId: "a", event: last }),
  ];
};

const render = (events: RecordedEvent[]): string => renderTrace(replayTrace(events), summarizeEpisodes(events));

describe("renderTrace", () => {
  it("shows the gate verdict, draft, perceived context and domain context for an acted episode", () => {
    const out = render(fullComplaint("acted"));
    expect(out).toContain("ACTED");
    expect(out).toContain("0.9");
    expect(out).toContain("0.8");
    expect(out).toContain("T3");
    expect(out).toContain("We're sorry for the delay.");
    expect(out).toContain("perceived c1");
    expect(out).toContain("ObjectCreated");
    expect(out).toContain("no second source of truth");
  });

  it("shows the escalation reason verbatim for an escalated episode", () => {
    const out = render(fullComplaint("escalated"));
    expect(out).toContain("ESCALATED");
    expect(out).toContain("confidence 0.4 below threshold 0.8");
  });

  it("renders the outcome with evidence when present", () => {
    const events = [
      ...fullComplaint("acted"),
      rec({ eventId: "ob", globalSeq: 6, correlationId: "p", causationId: "x", event: { type: "OutcomeObserved", wasCorrect: true, evidence: "human approved" } }),
    ];
    expect(render(events)).toContain("human approved");
  });

  it("flags a dangling causation (sliced read) with the external-cause marker", () => {
    // A confidence assessment whose causing proposal lives outside the slice:
    // replayTrace surfaces it as a root with externalCause set — a glass-box
    // signal that the trace is partial, which the renderer must show.
    const sliced = [
      rec({ eventId: "a", globalSeq: 4, correlationId: "p", causationId: "p-outside", event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
    ];
    const out = renderTrace(replayTrace(sliced), summarizeEpisodes(sliced));
    expect(out).toContain("↑");
    expect(out).toContain("p-outsid");
  });

  it("no-ops cleanly on an empty forest", () => {
    const out = renderTrace([], []);
    expect(out).toContain("reconstructed from 0 event(s)");
    expect(out).not.toContain("▸ episode");
  });

  it("terminates on a cyclic fixture instead of stack-overflowing", () => {
    const a = { eventId: "a", correlationId: "a", causationId: "b", type: "NoteAdded" as const, seq: 1, globalSeq: 1, objectId: "o", occurredAt: "t", actor: "t", summary: "a", event: { type: "NoteAdded" as const, text: "a" }, metadata: { actor: "t" }, children: [] as unknown[] };
    const b = { eventId: "b", correlationId: "a", causationId: "a", type: "NoteAdded" as const, seq: 2, globalSeq: 2, objectId: "o", occurredAt: "t", actor: "t", summary: "b", event: { type: "NoteAdded" as const, text: "b" }, metadata: { actor: "t" }, children: [a] };
    a.children.push(b);
    expect(() => renderTrace([a] as never, [])).not.toThrow();
  });
});
