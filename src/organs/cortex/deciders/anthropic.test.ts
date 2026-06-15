// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AnthropicDecider } from "./anthropic.js";

/** A stub Anthropic client whose messages.create returns a canned tool_use. */
function stubClient(content: unknown[]): Anthropic {
  return {
    messages: { create: async () => ({ content }) },
  } as unknown as Anthropic;
}

const context = { objectId: "c1", seq: 2, text: "my order never arrived" };

describe("AnthropicDecider", () => {
  it("returns the validated, clamped proposal from the tool_use input", async () => {
    const decider = new AnthropicDecider({
      client: stubClient([{ type: "tool_use", name: "submit_proposal", input: { draft: "We're sorry…", confidence: 1.4 } }]),
      model: "claude-haiku-4-5",
    });
    const proposal = await decider.propose(context);
    expect(proposal).toEqual({ draft: "We're sorry…", confidence: 1 });
  });

  it("throws when there is no tool_use block", async () => {
    const decider = new AnthropicDecider({ client: stubClient([{ type: "text", text: "hi" }]) });
    await expect(decider.propose(context)).rejects.toThrow();
  });

  it("rejects a malformed tool input rather than passing it through", async () => {
    const decider = new AnthropicDecider({
      client: stubClient([{ type: "tool_use", name: "submit_proposal", input: { draft: "x" } }]),
    });
    await expect(decider.propose(context)).rejects.toThrow();
  });
});
