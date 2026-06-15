// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The one shared shape every Decider adapter must return — validated at the
 * trust boundary (the kernel's zod-at-the-edge discipline, ADR-0002). Each
 * provider fills this from its own native structured-output mechanism; this
 * schema is the single source of truth for the proposal shape, so the A/B
 * compares like with like. Confidence is the honest placeholder (self-reported
 * by the model); we clamp it to [0,1] so a stray 1.2 can't escape the gate.
 */

import { z } from "zod";
import type { Proposal } from "../decider.js";

export const proposalSchema = z.object({
  draft: z.string(),
  confidence: z.number(),
});

/** Validate an untrusted decider output and return a clamped `Proposal`. */
export function parseProposal(candidate: unknown): Proposal {
  const { draft, confidence } = proposalSchema.parse(candidate);
  return { draft, confidence: Math.max(0, Math.min(1, confidence)) };
}
