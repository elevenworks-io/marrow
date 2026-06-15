// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The shared context-engineering surface for the proposal task. Both adapters
 * build their request from this, so the *prompt* is held constant across the
 * A/B — only the model differs. Thin on purpose: the complaint text in, a
 * draft reply + a self-assessed confidence out.
 */

import type { DecisionContext } from "../decider.js";

export interface ProposalPrompt {
  readonly system: string;
  readonly user: string;
}

export function buildProposalPrompt(context: DecisionContext): ProposalPrompt {
  return {
    system:
      "You are a customer-support agent. Draft a concise, empathetic reply to the " +
      "customer's complaint. Then rate your confidence, from 0 to 1, that the draft " +
      "is correct and ready to send without human review. Return only the draft and " +
      "the confidence.",
    user: `Complaint:\n${context.text}`,
  };
}
