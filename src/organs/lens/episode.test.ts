// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { summarizeEpisodes } from "./episode.js";

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

const actedChain = (corr: string, base: number): RecordedEvent[] => [
  rec({ eventId: `${corr}p`, globalSeq: base + 1, correlationId: corr, event: { type: "DecisionProposed", draft: "Sorry!", perceivedObjectId: "c1", perceivedSeq: 2 } }),
  rec({ eventId: `${corr}a`, globalSeq: base + 2, correlationId: corr, causationId: `${corr}p`, event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
  rec({ eventId: `${corr}x`, globalSeq: base + 3, correlationId: corr, causationId: `${corr}a`, event: { type: "Acted", draftRef: `${corr}p` } }),
];

describe("summarizeEpisodes", () => {
  it("summarizes an acted episode, restoring threshold/tier/draft/perceived", () => {
    const [s] = summarizeEpisodes(actedChain("E", 0));
    expect(s).toMatchObject({
      correlationId: "E",
      status: "acted",
      gateVerdict: "act",
      confidence: 0.9,
      threshold: 0.8,
      tier: "T3",
      draft: "Sorry!",
      perceivedObjectId: "c1",
      perceivedSeq: 2,
    });
    expect(s!.outcome).toBeUndefined();
  });

  it("keeps the proposed draft even when the episode escalated", () => {
    const events: RecordedEvent[] = [
      rec({ eventId: "Ep", globalSeq: 1, correlationId: "E", event: { type: "DecisionProposed", draft: "Maybe?", perceivedObjectId: "c1", perceivedSeq: 2 } }),
      rec({ eventId: "Ea", globalSeq: 2, correlationId: "E", causationId: "Ep", event: { type: "ConfidenceAssessed", confidence: 0.4, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "Ex", globalSeq: 3, correlationId: "E", causationId: "Ea", event: { type: "Escalated", reason: "too low" } }),
    ];
    const [s] = summarizeEpisodes(events);
    expect(s!.status).toBe("escalated");
    expect(s!.gateVerdict).toBe("escalate");
    expect(s!.draft).toBe("Maybe?");
  });

  it("a proposed-only episode has null threshold, tier, gateVerdict, and confidence", () => {
    const events = [
      rec({ eventId: "Ep", globalSeq: 1, correlationId: "E", event: { type: "DecisionProposed", draft: "Draft.", perceivedObjectId: "c1", perceivedSeq: 1 } }),
    ];
    const [s] = summarizeEpisodes(events);
    expect(s!.status).toBe("proposed");
    expect(s!.gateVerdict).toBeNull();
    expect(s!.confidence).toBeNull();
    expect(s!.threshold).toBeNull();
    expect(s!.tier).toBeNull();
    expect(s!.draft).toBe("Draft.");
  });

  it("restores outcome with evidence when present", () => {
    const events = [
      ...actedChain("E", 0),
      rec({ eventId: "Eo", globalSeq: 4, correlationId: "E", causationId: "Ex", event: { type: "OutcomeObserved", wasCorrect: true, evidence: "human approved" } }),
    ];
    const [s] = summarizeEpisodes(events);
    expect(s!.outcome).toEqual({ wasCorrect: true, evidence: "human approved" });
  });

  it("returns one summary per episode on a multi-episode object (no last-wins collapse)", () => {
    const events = [...actedChain("E1", 0), ...actedChain("E2", 10)];
    const summaries = summarizeEpisodes(events);
    expect(summaries.map((s) => s.correlationId).sort()).toEqual(["E1", "E2"]);
  });

  it("ignores correlations without a decision, and empty input", () => {
    const domain = [rec({ eventId: "o", event: { type: "ObjectCreated", id: "obj", objectType: "complaint" } })];
    expect(summarizeEpisodes(domain)).toEqual([]);
    expect(summarizeEpisodes([])).toEqual([]);
  });
});
