// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Per-episode audit summary. Groups events by correlationId; for each
 * correlation that holds a decision, it reuses the canonical `replayDecision`
 * fold (one episode per slice — its assumption holds here) for status +
 * confidence, and restores the audit fields replayDecision deliberately drops:
 * threshold/tier, the proposed draft, the perceived context, and the outcome's
 * evidence. Pure: a function of the events alone.
 */

import type { ActionTier, RecordedEvent } from "../../mark/index.js";
import { replayDecision } from "../cortex/index.js";

export interface EpisodeSummary {
  readonly correlationId: string;
  readonly status: "proposed" | "acted" | "escalated";
  readonly gateVerdict: "act" | "escalate" | null;
  readonly confidence: number | null;
  readonly threshold: number | null;
  readonly tier: ActionTier | null;
  readonly draft: string | null;
  readonly perceivedObjectId: string | null;
  readonly perceivedSeq: number | null;
  readonly outcome?: { readonly wasCorrect: boolean; readonly evidence: string | null };
}

/** Total order on a single Mark: globalSeq is unique; eventId is tiebreak (parity with trace.ts). */
const byOrder = (a: { globalSeq: number; eventId: string }, b: { globalSeq: number; eventId: string }): number =>
  a.globalSeq - b.globalSeq || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

export function summarizeEpisodes(events: readonly RecordedEvent[]): readonly EpisodeSummary[] {
  const sorted = [...events].sort(byOrder);
  const byCorrelation = new Map<string, RecordedEvent[]>();
  for (const r of sorted) {
    const list = byCorrelation.get(r.correlationId) ?? [];
    list.push(r);
    byCorrelation.set(r.correlationId, list);
  }

  const summaries: EpisodeSummary[] = [];
  for (const [correlationId, slice] of byCorrelation) {
    if (!slice.some((r) => r.event.type === "DecisionProposed")) continue;
    const episode = replayDecision(slice);
    if (episode === null) continue;

    const proposed = slice.find((r) => r.event.type === "DecisionProposed");
    const assessed = slice.find((r) => r.event.type === "ConfidenceAssessed");
    const observed = slice.find((r) => r.event.type === "OutcomeObserved");

    // Narrow once each; `.find` guarantees the type but TS still needs the guard.
    const dp = proposed?.event.type === "DecisionProposed" ? proposed.event : null;
    const ca = assessed?.event.type === "ConfidenceAssessed" ? assessed.event : null;

    // Source draft from the raw event — replayDecision nulls it on escalation.
    const draft = dp?.draft ?? null;
    const perceivedObjectId = dp?.perceivedObjectId ?? null;
    const perceivedSeq = dp?.perceivedSeq ?? null;
    // threshold and tier are dropped by replayDecision; restore from the raw event.
    const threshold = ca?.threshold ?? null;
    const tier = ca?.tier ?? null;
    const gateVerdict: "act" | "escalate" | null =
      episode.status === "acted" ? "act" : episode.status === "escalated" ? "escalate" : null;

    const base: EpisodeSummary = {
      correlationId,
      status: episode.status,
      gateVerdict,
      confidence: episode.confidence,
      threshold,
      tier,
      draft,
      perceivedObjectId,
      perceivedSeq,
    };
    summaries.push(
      observed?.event.type === "OutcomeObserved"
        ? { ...base, outcome: { wasCorrect: observed.event.wasCorrect, evidence: observed.event.evidence } }
        : base,
    );
  }
  return summaries;
}
