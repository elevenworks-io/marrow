// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { replayDecision } from "./decision.js";

/** Build a minimal RecordedEvent for folding tests. */
function rec(event: MarkEvent, seq: number, correlationId = "run-1"): RecordedEvent {
  return {
    eventId: `evt-${seq}`,
    correlationId,
    causationId: null,
    globalSeq: seq,
    objectId: "c1",
    seq,
    schemaVersion: 1,
    event,
    metadata: { actor: "cortex" },
    occurredAt: "2026-06-15T00:00:00.000Z",
    recordedAt: "2026-06-15T00:00:00.000Z",
  };
}

describe("replayDecision", () => {
  it("folds the acted chain into an episode with the draft and confidence", () => {
    const episode = replayDecision([
      rec({ type: "ObjectCreated", id: "c1", objectType: "complaint" }, 1),
      rec({ type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 1 }, 2),
      rec({ type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" }, 3),
      rec({ type: "Acted", draftRef: "evt-2" }, 4),
    ]);

    expect(episode).toEqual({
      episode: "run-1",
      status: "acted",
      draft: "We're sorry…",
      confidence: 0.9,
      perceivedObjectId: "c1",
      perceivedSeq: 1,
    });
  });

  it("folds the escalated chain with no released draft", () => {
    const episode = replayDecision([
      rec({ type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 1 }, 1),
      rec({ type: "ConfidenceAssessed", confidence: 0.4, threshold: 0.8, tier: "T3" }, 2),
      rec({ type: "Escalated", reason: "below threshold" }, 3),
    ]);

    expect(episode?.status).toBe("escalated");
    expect(episode?.draft).toBeNull();
    expect(episode?.confidence).toBe(0.4);
  });

  it("returns null when the agent never acted on the object", () => {
    const episode = replayDecision([
      rec({ type: "ObjectCreated", id: "c1", objectType: "complaint" }, 1),
      rec({ type: "AttributeSet", key: "text", value: "late" }, 2),
    ]);

    expect(episode).toBeNull();
  });
});
