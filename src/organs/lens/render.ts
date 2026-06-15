// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 plain-text renderer (no ANSI → deterministic, snapshot-testable; the
 * demo adds colour). One consumer of the structured TraceForest. Surfaces the
 * "why" first-class: the gate verdict, the draft, the perceived context, the
 * escalation reason, and the outcome — with domain events shown as context,
 * never hidden. A cycle (only possible from corrupt input) is surfaced, not
 * followed.
 */

import type { EpisodeSummary } from "./episode.js";
import type { TraceForest, TraceNode } from "./trace.js";

function header(e: EpisodeSummary): string {
  const verdict = e.status.toUpperCase();
  const op = e.status === "acted" ? "≥" : e.status === "escalated" ? "<" : "?";
  const gate = e.confidence !== null && e.threshold !== null ? `${e.confidence} ${op} ${e.threshold}` : "n/a";
  const tier = e.tier ?? "?";
  const outcome = e.outcome ? (e.outcome.wasCorrect ? "correct" : "incorrect") : "—";
  const perceived = e.perceivedObjectId !== null ? ` · perceived ${e.perceivedObjectId}@${e.perceivedSeq}` : "";
  return `▸ episode ${e.correlationId.slice(0, 8)} — ${verdict} (${gate}, ${tier}) — outcome: ${outcome}${perceived}`;
}

export function renderTrace(forest: TraceForest, episodes: readonly EpisodeSummary[] = []): string {
  const byCorrelation = new Map(episodes.map((e) => [e.correlationId, e]));
  const lines: string[] = [];
  // Forest-scoped: replayTrace() guarantees each eventId occupies exactly one
  // position on a valid Mark (danglers become roots, never duplicates), so this
  // never elides a legitimate node. It fires only on corrupt cyclic input — the
  // label says "already shown" (not "cycle") because cross-root sharing, were
  // the forest contract ever to relax to a DAG, would also land here.
  const seen = new Set<string>();
  // Counts uniquely-rendered nodes. On valid input that equals the event count
  // (no cycles); on corrupt cyclic input it under-counts, which is acceptable.
  let count = 0;

  const walk = (node: TraceNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    if (seen.has(node.eventId)) {
      lines.push(`${indent}↻ already shown: ${node.eventId}`);
      return;
    }
    seen.add(node.eventId);
    count += 1;
    const flag = node.externalCause ? `↑(${node.externalCause.slice(0, 8)}) ` : "";
    lines.push(`${indent}● ${node.type}  ${flag}${node.summary}  [actor=${node.actor}]`);
    for (const child of node.children) walk(child, depth + 1);
  };

  for (const root of forest) {
    // Print the episode header just above its DecisionProposed root. Gating on
    // the node type (not merely a correlation match) is deliberate: a domain
    // event sharing the decision's correlationId must not trigger a second
    // header. summarizeEpisodes() only emits episodes for correlations that hold
    // a DecisionProposed, so a matched episode always has such a root to anchor.
    const episode = byCorrelation.get(root.correlationId);
    if (episode !== undefined && root.type === "DecisionProposed") {
      lines.push(header(episode));
    }
    walk(root, 0);
  }

  lines.push("");
  lines.push(`reconstructed from ${count} event(s) — no second source of truth`);
  return lines.join("\n");
}
