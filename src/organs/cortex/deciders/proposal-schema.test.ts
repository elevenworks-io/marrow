// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { parseProposal } from "./proposal-schema.js";

describe("parseProposal", () => {
  it("accepts a well-formed proposal", () => {
    expect(parseProposal({ draft: "Sorry to hear that.", confidence: 0.9 })).toEqual({
      draft: "Sorry to hear that.",
      confidence: 0.9,
    });
  });

  it("clamps confidence into [0,1]", () => {
    expect(parseProposal({ draft: "x", confidence: 1.5 }).confidence).toBe(1);
    expect(parseProposal({ draft: "x", confidence: -0.2 }).confidence).toBe(0);
  });

  it("rejects a malformed proposal", () => {
    expect(() => parseProposal({ draft: "x" })).toThrow();
    expect(() => parseProposal({ draft: 1, confidence: 0.5 })).toThrow();
    expect(() => parseProposal(null)).toThrow();
  });
});
