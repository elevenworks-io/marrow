// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The autonomy gate (ADR-0010). The action *risk tier* sets the floor;
 * confidence only modulates within a tier. "Confidence ≠ permission": a
 * high-confidence T4 action is still escalated. Calibration is out of scope for
 * this slice — `threshold` is a tunable input, not yet empirically fit.
 */

import type { ActionTier } from "../../mark/index.js";

export type GateOutcome = "act" | "escalate";

export function gate(tier: ActionTier, confidence: number, threshold: number): GateOutcome {
  switch (tier) {
    case "T1": // read-only
    case "T2": // reversible-internal
      return "act";
    case "T3": // external / irreversible to third parties (e.g. an outbound reply)
      return confidence >= threshold ? "act" : "escalate";
    case "T4": // high-risk irreversible — human approval, no exceptions
      return "escalate";
    default: {
      const unreachable: never = tier;
      throw new Error(`unknown action tier: ${String(unreachable)}`);
    }
  }
}
