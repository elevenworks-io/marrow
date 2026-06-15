// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import { OpenAIDecider } from "./openai.js";

/** A stub OpenAI client whose chat.completions.parse returns a canned result. */
function stubClient(parsed: unknown): OpenAI {
  return {
    chat: { completions: { parse: async () => ({ choices: [{ message: { parsed } }] }) } },
  } as unknown as OpenAI;
}

const context = { objectId: "c1", seq: 2, text: "my order never arrived" };

describe("OpenAIDecider", () => {
  it("returns the validated, clamped proposal from the parsed message", async () => {
    const decider = new OpenAIDecider({
      client: stubClient({ draft: "We understand…", confidence: -0.3 }),
      model: "test-model",
    });
    const proposal = await decider.propose(context);
    expect(proposal).toEqual({ draft: "We understand…", confidence: 0 });
  });

  it("throws when no model is configured", () => {
    expect(() => new OpenAIDecider({ client: stubClient(null), model: "" })).toThrow();
  });

  it("throws when the model returns no parsed proposal", async () => {
    const decider = new OpenAIDecider({ client: stubClient(null), model: "test-model" });
    await expect(decider.propose(context)).rejects.toThrow();
  });

  it("rejects a malformed parsed proposal rather than passing it through", async () => {
    const decider = new OpenAIDecider({ client: stubClient({ confidence: 0.5 }), model: "test-model" });
    await expect(decider.propose(context)).rejects.toThrow();
  });
});
