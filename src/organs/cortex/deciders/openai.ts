// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The OpenAI implementation of the `Decider` seam (§3.5) — proof the seam is
 * vendor-neutral: a second provider is a second file, with zero changes to the
 * Cortex, the gate, or the events. The OpenAI SDK is imported *only* here (a
 * containment test enforces it). Provider reached via its native structured
 * output (`chat.completions.parse` + `zodResponseFormat`); the result is
 * re-validated at our boundary and clamped.
 *
 * The model is config: `MARROW_CORTEX_OPENAI_MODEL` or the constructor. There
 * is no hardcoded default model — OpenAI model ids move, and structured-output
 * support varies, so the model must be set explicitly for a live run (the demo
 * checks for it). `client` is injectable so tests stub it — no network in tests.
 */

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { Decider, DecisionContext, Proposal } from "../decider.js";
import { buildProposalPrompt } from "./prompt.js";
import { proposalSchema, parseProposal } from "./proposal-schema.js";

export interface OpenAIDeciderOptions {
  /** Inject a client (real or stub). Defaults to a new OpenAI SDK client. */
  readonly client?: OpenAI;
  /** Model id; defaults to MARROW_CORTEX_OPENAI_MODEL (no hardcoded fallback). */
  readonly model?: string;
  readonly apiKey?: string;
}

export class OpenAIDecider implements Decider {
  readonly #client: OpenAI;
  readonly #model: string;

  constructor(options: OpenAIDeciderOptions = {}) {
    this.#client = options.client ?? new OpenAI(options.apiKey ? { apiKey: options.apiKey } : {});
    const model = options.model ?? process.env.MARROW_CORTEX_OPENAI_MODEL;
    if (model === undefined || model === "") {
      throw new Error(
        "OpenAIDecider needs a model — set MARROW_CORTEX_OPENAI_MODEL or pass { model }",
      );
    }
    this.#model = model;
  }

  async propose(context: DecisionContext): Promise<Proposal> {
    const { system, user } = buildProposalPrompt(context);
    const completion = await this.#client.chat.completions.parse({
      model: this.#model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: zodResponseFormat(proposalSchema, "proposal"),
    });
    const parsed = completion.choices[0]?.message.parsed;
    if (parsed == null) {
      throw new Error(`OpenAIDecider (${this.#model}) returned no parsed proposal`);
    }
    return parseProposal(parsed);
  }
}
