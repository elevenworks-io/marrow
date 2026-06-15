// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { FakeDecider } from "./decider.js";
import { compareDeciders } from "./ab.js";

const context = { objectId: "c1", seq: 2, text: "my order never arrived" };

describe("compareDeciders", () => {
  it("runs the same context through every decider and pairs each with its gate verdict", async () => {
    const rows = await compareDeciders(
      context,
      [
        { name: "alpha", decider: new FakeDecider({ draft: "A", confidence: 0.92 }) },
        { name: "beta", decider: new FakeDecider({ draft: "B", confidence: 0.4 }) },
      ],
      0.8,
    );

    expect(rows).toEqual([
      { name: "alpha", proposal: { draft: "A", confidence: 0.92 }, gate: "act" },
      { name: "beta", proposal: { draft: "B", confidence: 0.4 }, gate: "escalate" },
    ]);
  });

  it("preserves entry order", async () => {
    const rows = await compareDeciders(context, [
      { name: "first", decider: new FakeDecider({ draft: "1", confidence: 0.9 }) },
      { name: "second", decider: new FakeDecider({ draft: "2", confidence: 0.9 }) },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["first", "second"]);
  });
});
