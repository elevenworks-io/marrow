// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import { summaryOf } from "./trace.js";

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
