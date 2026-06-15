// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { gate } from "./gate.js";

describe("gate", () => {
  it("T3 acts at or above the threshold", () => {
    expect(gate("T3", 0.8, 0.8)).toBe("act");
    expect(gate("T3", 0.95, 0.8)).toBe("act");
  });

  it("T3 escalates below the threshold", () => {
    expect(gate("T3", 0.5, 0.8)).toBe("escalate");
  });

  it("T1 and T2 act regardless of confidence", () => {
    expect(gate("T1", 0, 0.8)).toBe("act");
    expect(gate("T2", 0, 0.8)).toBe("act");
  });

  it("T4 escalates even at full confidence — confidence is not permission", () => {
    expect(gate("T4", 1, 0.8)).toBe("escalate");
  });
});
