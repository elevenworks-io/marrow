// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Anthropic implementation of the `Decider` seam (§3.5). The Anthropic SDK
 * is imported *only* here — the Cortex core never sees it, which is what keeps
 * the substrate model-agnostic (a containment test enforces this). Structured
 * output is obtained via forced tool use (`tool_choice` on a single
 * `submit_proposal` tool) — provider-native and compatible with our zod v3,
 * unlike the SDK's `zodOutputFormat` helper which requires zod v4. The tool
 * input is re-validated at our boundary and clamped.
 *
 * The model is config: `MARROW_CORTEX_ANTHROPIC_MODEL` or the constructor,
 * defaulting to the cheap tier so the A/B runs cheaply. `client` is injectable
 * so tests stub it — this file makes no network call under test.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { Decider, DecisionContext, Proposal } from "../decider.js";
import { buildProposalPrompt } from "./prompt.js";
import { parseProposal } from "./proposal-schema.js";

/** The structured-output tool: the model must call it with {draft, confidence}. */
const PROPOSAL_TOOL: Anthropic.Tool = {
  name: "submit_proposal",
  description: "Submit the drafted reply and your confidence that it is ready to send.",
  input_schema: {
    type: "object",
    properties: {
      draft: { type: "string", description: "the reply to send to the customer" },
      confidence: { type: "number", description: "0 to 1: confidence the draft is correct and ready" },
    },
    required: ["draft", "confidence"],
  },
};

export interface AnthropicDeciderOptions {
  /** Inject a client (real or stub). Defaults to a new Anthropic SDK client. */
  readonly client?: Anthropic;
  /** Model id; defaults to MARROW_CORTEX_ANTHROPIC_MODEL ?? "claude-haiku-4-5". */
  readonly model?: string;
  readonly apiKey?: string;
}

export class AnthropicDecider implements Decider {
  readonly #client: Anthropic;
  readonly #model: string;

  constructor(options: AnthropicDeciderOptions = {}) {
    this.#client = options.client ?? new Anthropic(options.apiKey ? { apiKey: options.apiKey } : {});
    this.#model = options.model ?? process.env.MARROW_CORTEX_ANTHROPIC_MODEL ?? "claude-haiku-4-5";
  }

  async propose(context: DecisionContext): Promise<Proposal> {
    const { system, user } = buildProposalPrompt(context);
    const message = await this.#client.messages.create({
      model: this.#model,
      max_tokens: 1024,
      system,
      messages: [{ role: "user", content: user }],
      tools: [PROPOSAL_TOOL],
      tool_choice: { type: "tool", name: PROPOSAL_TOOL.name },
    });
    const block = message.content.find((b) => b.type === "tool_use");
    if (block === undefined || block.type !== "tool_use") {
      throw new Error(`AnthropicDecider (${this.#model}) did not return a proposal tool call`);
    }
    return parseProposal(block.input);
  }
}
