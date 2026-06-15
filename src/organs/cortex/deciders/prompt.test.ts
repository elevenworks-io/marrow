// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { buildProposalPrompt } from "./prompt.js";

describe("buildProposalPrompt", () => {
  it("puts the complaint text in the user message and asks for a confidence", () => {
    const { system, user } = buildProposalPrompt({
      objectId: "c1",
      seq: 2,
      text: "my order never arrived",
    });
    expect(user).toContain("my order never arrived");
    expect(system.toLowerCase()).toContain("confidence");
  });
});
