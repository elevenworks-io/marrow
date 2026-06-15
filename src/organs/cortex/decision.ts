// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The decision-trace projection (2B-lite). The agent's decision chain
 * (DecisionProposed → ConfidenceAssessed → Acted | Escalated → OutcomeObserved,
 * ADR-0010) lives on the acted-upon object's event stream, but it is keyed by
 * `correlationId` (the run/episode), not by `objectId`. So it is folded by a
 * *separate* projection — not into ObjectState (ADR-0004: decision/cross-object
 * read models are their own named projections). In-memory only here; the same
 * fold becomes a persisted, cross-object projection when Layer 2 lands —
 * migration-free, since the events are the single source of truth.
 */

import type { RecordedEvent } from "../../mark/index.js";

export interface DecisionEpisode {
  /** The run's correlationId. */
  readonly episode: string;
  readonly status: "proposed" | "acted" | "escalated";
  /** The released draft reply (when acted); null while proposed or escalated. */
  readonly draft: string | null;
  readonly confidence: number | null;
  readonly perceivedObjectId: string;
  readonly perceivedSeq: number;
  readonly outcome?: { readonly wasCorrect: boolean };
}

/**
 * Fold an object's recorded events into its decision episode, or null if the
 * agent never decided on it. Assumes at most one episode per object (true for
 * this slice — one Cortex run per object); when an object can host several runs
 * this generalizes to a Map keyed by `correlationId`.
 */
export function replayDecision(events: readonly RecordedEvent[]): DecisionEpisode | null {
  let episode: DecisionEpisode | null = null;

  for (const recorded of events) {
    const e = recorded.event;
    switch (e.type) {
      case "DecisionProposed":
        episode = Object.freeze({
          episode: recorded.correlationId,
          status: "proposed" as const,
          draft: e.draft,
          confidence: null,
          perceivedObjectId: e.perceivedObjectId,
          perceivedSeq: e.perceivedSeq,
        });
        break;
      case "ConfidenceAssessed":
        if (episode !== null) {
          const next: Record<string, unknown> = {
            episode: episode.episode,
            status: episode.status,
            draft: episode.draft,
            confidence: e.confidence,
            perceivedObjectId: episode.perceivedObjectId,
            perceivedSeq: episode.perceivedSeq,
          };
          if (episode.outcome) next.outcome = episode.outcome;
          episode = Object.freeze(next as unknown as DecisionEpisode);
        }
        break;
      case "Acted":
        if (episode !== null) {
          const next: Record<string, unknown> = {
            episode: episode.episode,
            status: "acted" as const,
            draft: episode.draft,
            confidence: episode.confidence,
            perceivedObjectId: episode.perceivedObjectId,
            perceivedSeq: episode.perceivedSeq,
          };
          if (episode.outcome) next.outcome = episode.outcome;
          episode = Object.freeze(next as unknown as DecisionEpisode);
        }
        break;
      case "Escalated":
        if (episode !== null) {
          const next: Record<string, unknown> = {
            episode: episode.episode,
            status: "escalated" as const,
            draft: null,
            confidence: episode.confidence,
            perceivedObjectId: episode.perceivedObjectId,
            perceivedSeq: episode.perceivedSeq,
          };
          if (episode.outcome) next.outcome = episode.outcome;
          episode = Object.freeze(next as unknown as DecisionEpisode);
        }
        break;
      case "OutcomeObserved":
        if (episode !== null) {
          const next: Record<string, unknown> = {
            episode: episode.episode,
            status: episode.status,
            draft: episode.draft,
            confidence: episode.confidence,
            perceivedObjectId: episode.perceivedObjectId,
            // `evidence` is kept on the raw event (glass-box, via get_history);
            // the projection deliberately surfaces only `wasCorrect` for now.
            perceivedSeq: episode.perceivedSeq,
            outcome: { wasCorrect: e.wasCorrect },
          };
          episode = Object.freeze(next as unknown as DecisionEpisode);
        }
        break;
      default:
        break; // domain events (ObjectCreated, AttributeSet, …) are not part of the trace
    }
  }

  return episode;
}
