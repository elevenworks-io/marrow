// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Cortex — MARROW's agent loop (VISION §4). Public surface: the orchestrator,
 * the model-agnostic Decider seam, the autonomy gate, and the decision-trace
 * projection. This slice perceives, decides, gates, and records *why* — no real
 * side effect leaves the system.
 */

export { Cortex, type CortexOptions } from "./cortex.js";
export { type Decider, type DecisionContext, type Proposal, FakeDecider } from "./decider.js";
export { gate, type GateOutcome } from "./gate.js";
export { replayDecision, type DecisionEpisode } from "./decision.js";
export { readObjectWithDecision, type ObjectWithDecision } from "./read.js";
export {
  compareDeciders,
  type DeciderEntry,
  type ComparisonRow,
} from "./ab.js";
export { buildProposalPrompt, type ProposalPrompt } from "./deciders/prompt.js";
export { proposalSchema, parseProposal } from "./deciders/proposal-schema.js";
export { AnthropicDecider, type AnthropicDeciderOptions } from "./deciders/anthropic.js";
export { OpenAIDecider, type OpenAIDeciderOptions } from "./deciders/openai.js";
