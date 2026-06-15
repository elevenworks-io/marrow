// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { FakeDecider } from "./decider.js";

describe("FakeDecider", () => {
  it("returns its scripted proposal and counts calls", async () => {
    const decider = new FakeDecider({ draft: "Sorry to hear that.", confidence: 0.9 });

    const proposal = await decider.propose({ objectId: "c1", seq: 2, text: "late delivery" });

    expect(proposal).toEqual({ draft: "Sorry to hear that.", confidence: 0.9 });
    expect(decider.calls).toBe(1);
  });
});
