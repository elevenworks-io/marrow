// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The model-agnostic decision seam (§3.5). The Cortex treats the LLM as a pure
 * function `(context) → proposal` (ADR-0007): the result is recorded as an
 * event, so a replay or retry never re-rolls it. Every provider — Anthropic,
 * OpenAI, a local vLLM/Ollama model, an EU API — is an interchangeable
 * `Decider`; no vendor SDK leaks into the core. This slice ships only the
 * deterministic `FakeDecider`; a real adapter is a clean follow-up behind the
 * same interface.
 */

/** What the Cortex perceived, handed to the decider. */
export interface DecisionContext {
  readonly objectId: string;
  readonly seq: number;
  readonly text: string;
}

/** The decider's single output: a draft reply + a self-assessed confidence. */
export interface Proposal {
  readonly draft: string;
  readonly confidence: number;
}

/** A model that turns a perceived context into one proposal. */
export interface Decider {
  propose(context: DecisionContext): Promise<Proposal>;
}

/** A scripted, deterministic decider for tests and the no-API-key demo. */
export class FakeDecider implements Decider {
  #calls = 0;

  constructor(private readonly proposal: Proposal) {}

  /** How many times `propose` has been called — proves replay does not re-roll. */
  get calls(): number {
    return this.#calls;
  }

  async propose(_context: DecisionContext): Promise<Proposal> {
    this.#calls += 1;
    return this.proposal;
  }
}
