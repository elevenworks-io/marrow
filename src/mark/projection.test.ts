// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type { MarkEvent } from "./event.js";
import { replay, ReplayError } from "./projection.js";

describe("replay", () => {
  it("reconstructs current state by folding an object's events in order", () => {
    const events: MarkEvent[] = [
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { type: "AttributeSet", key: "subject", value: "Burst pipe" },
      { type: "StateChanged", state: "open" },
      { type: "AttributeSet", key: "priority", value: "high" },
      { type: "StateChanged", state: "resolved" },
      { type: "NoteAdded", text: "Dispatched on-call tech" },
    ];

    const state = replay(events);

    expect(state).toEqual({
      id: "obj-1",
      objectType: "ticket",
      attributes: { subject: "Burst pipe", priority: "high" },
      state: "resolved",
      notes: ["Dispatched on-call tech"],
      version: 6,
    });
  });

  it("a later AttributeSet overrides an earlier one for the same key", () => {
    const state = replay([
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { type: "AttributeSet", key: "priority", value: "low" },
      { type: "AttributeSet", key: "priority", value: "high" },
    ]);

    expect(state.attributes).toEqual({ priority: "high" });
  });

  it("rejects an empty sequence — no events, no object", () => {
    expect(() => replay([])).toThrow(ReplayError);
  });

  it("rejects a sequence that does not begin with ObjectCreated", () => {
    expect(() =>
      replay([{ type: "StateChanged", state: "open" }]),
    ).toThrow(ReplayError);
  });

  it("rejects re-creating an object that already exists", () => {
    expect(() =>
      replay([
        { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
        { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      ]),
    ).toThrow(ReplayError);
  });

  it("returns frozen state, so a projection can never be mutated in place", () => {
    const state = replay([
      { type: "ObjectCreated", id: "obj-1", objectType: "ticket" },
      { type: "NoteAdded", text: "first" },
    ]);

    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.attributes)).toBe(true);
    expect(Object.isFrozen(state.notes)).toBe(true);
  });

  it("folds decision-chain events as version-only pass-through (ObjectState stays field-clean)", () => {
    const state = replay([
      { type: "ObjectCreated", id: "c1", objectType: "complaint" },
      { type: "AttributeSet", key: "text", value: "my order never arrived" },
      { type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 2 },
      { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" },
      { type: "Acted", draftRef: "evt-1" },
    ]);

    expect(state.version).toBe(5);
    expect(state.attributes).toEqual({ text: "my order never arrived" });
    expect(state.state).toBeNull();
    expect("decision" in state).toBe(false);
  });
});
