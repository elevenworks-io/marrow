// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The A/B harness — run one context through several deciders and compare. It is
 * a thin tool *over* the seam, not part of the Cortex loop: it does not write to
 * the Mark and has no model knowledge of its own. Each row pairs a decider's
 * proposal with what the gate (ADR-0010, tier T3) would decide for it, so you
 * can see not just the two drafts but whether each provider would act or
 * escalate at the same threshold. This is NOT a router — it runs every decider;
 * it does not pick one.
 */

import type { Decider, DecisionContext, Proposal } from "./decider.js";
import { gate, type GateOutcome } from "./gate.js";

/** A named decider to put in the comparison. */
export interface DeciderEntry {
  readonly name: string;
  readonly decider: Decider;
}

/** One provider's result: its proposal and the gate's verdict on it. */
export interface ComparisonRow {
  readonly name: string;
  readonly proposal: Proposal;
  readonly gate: GateOutcome;
}

/** "Draft a reply" is external → tier T3 (ADR-0010), as in the Cortex. */
const REPLY_TIER = "T3" as const;

/**
 * Run `context` through every entry concurrently and return one row per entry,
 * in entry order, each carrying the proposal and the gate outcome at `threshold`.
 *
 * All-or-nothing: if any decider throws (e.g. a bad key on one provider), the
 * whole call rejects — a comparison with a silently-missing arm would mislead.
 */
export async function compareDeciders(
  context: DecisionContext,
  entries: ReadonlyArray<DeciderEntry>,
  threshold = 0.8,
): Promise<ComparisonRow[]> {
  return Promise.all(
    entries.map(async ({ name, decider }) => {
      const proposal = await decider.propose(context);
      return { name, proposal, gate: gate(REPLY_TIER, proposal.confidence, threshold) };
    }),
  );
}
