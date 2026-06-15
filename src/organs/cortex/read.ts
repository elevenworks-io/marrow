// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Reading an object *with* its decision trace — the 2B-lite merge. ObjectState
 * stays field-clean; a consumer that wants "is a draft pending / escalated?"
 * reads both projections (the domain fold via `load`, the decision fold via
 * `replayDecision`) and combines them here, rather than loading the decision
 * facet into the core projection (ADR-0004).
 */

import type { Mark, ObjectState } from "../../mark/index.js";
import { replayDecision, type DecisionEpisode } from "./decision.js";

export interface ObjectWithDecision {
  readonly state: ObjectState;
  readonly decision: DecisionEpisode | null;
}

export async function readObjectWithDecision(
  mark: Mark,
  id: string,
): Promise<ObjectWithDecision | null> {
  const state = await mark.load(id);
  if (state === null) return null;
  const decision = replayDecision(await mark.read(id));
  return { state, decision };
}
