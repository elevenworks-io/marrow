// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 — the trace projection. Folds an event stream into a causal forest
 * (keyed by causationId, objectId-agnostic) plus a one-line summary per event.
 * A pure function of the events: no persistence, no second source of truth —
 * the trace IS the events (VISION §3.1, ADR-0009/0004).
 */

import type { ActionTier, EventMetadata, Json, MarkEvent, MarkEventType, RecordedEvent } from "../../mark/index.js";

const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);
// `value` is a `Json` value, so JSON.stringify always returns a string here.
const valueOf = (v: Json): string => clip(JSON.stringify(v), 40);

/** A one-line, human-readable essence of an event. Exhaustive over the union:
 *  adding a MarkEvent variant is a compile error here (project hard rule). */
export function summaryOf(event: MarkEvent): string {
  switch (event.type) {
    case "ObjectCreated":
      return `created ${event.objectType}`;
    case "AttributeSet":
      return `${event.key} = ${valueOf(event.value)}`;
    case "StateChanged":
      return `state → ${event.state}`;
    case "NoteAdded":
      return `note: ${clip(event.text)}`;
    case "DecisionProposed":
      return `proposed: "${clip(event.draft)}" (perceived ${event.perceivedObjectId} @seq ${event.perceivedSeq})`;
    case "ConfidenceAssessed":
      return `confidence ${event.confidence} vs threshold ${event.threshold} (${event.tier})`;
    case "Acted":
      return `acted → released draft ${event.draftRef.slice(0, 8)}`;
    case "Escalated":
      return `escalated: ${clip(event.reason)}`;
    case "OutcomeObserved":
      return `outcome: ${event.wasCorrect ? "correct" : "incorrect"}${
        event.evidence ? ` — ${clip(event.evidence)}` : ""
      }`;
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event type: ${String(_exhaustive)}`);
    }
  }
}

export interface TraceNode {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly type: MarkEventType;
  readonly seq: number;
  readonly globalSeq: number;
  readonly objectId: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly confidence?: number;
  readonly tier?: ActionTier;
  readonly externalCause?: string;
  readonly summary: string;
  readonly event: MarkEvent;
  readonly metadata: EventMetadata;
  readonly children: readonly TraceNode[];
}

export type TraceForest = readonly TraceNode[];

/** Mutable builder mirror of TraceNode (children grow during the fold). */
type Building = Omit<TraceNode, "children" | "externalCause"> & {
  children: Building[];
  externalCause?: string;
};

/** Total order on a single Mark: globalSeq is unique; eventId is tiebreak
 *  insurance against accidentally-merged streams. */
const byOrder = (a: { globalSeq: number; eventId: string }, b: { globalSeq: number; eventId: string }): number =>
  a.globalSeq - b.globalSeq || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

function toNode(r: RecordedEvent): Building {
  const e = r.event;
  const node: Building = {
    eventId: r.eventId,
    correlationId: r.correlationId,
    causationId: r.causationId,
    type: e.type,
    seq: r.seq,
    globalSeq: r.globalSeq,
    objectId: r.objectId,
    occurredAt: r.occurredAt,
    actor: r.metadata.actor,
    summary: summaryOf(e),
    event: e,
    metadata: r.metadata,
    children: [],
  };
  const confidence = e.type === "ConfidenceAssessed" ? e.confidence : r.metadata.confidence;
  if (confidence !== undefined) (node as { confidence?: number }).confidence = confidence;
  if (e.type === "ConfidenceAssessed") (node as { tier?: ActionTier }).tier = e.tier;
  return node;
}

/**
 * Fold an event stream into a causal forest. Roots are events with no cause, or
 * with a `causationId` that dangles outside the set (flagged `externalCause` —
 * forward-looking; today's data never produces it). Pure and order-independent:
 * shuffle the input, get an identical forest.
 */
export function replayTrace(events: readonly RecordedEvent[]): TraceForest {
  const sorted = [...events].sort(byOrder);
  const map = new Map<string, Building>();
  for (const r of sorted) {
    if (map.has(r.eventId)) {
      throw new Error(`duplicate eventId "${r.eventId}" — corrupt event set`);
    }
    map.set(r.eventId, toNode(r));
  }

  const roots: Building[] = [];
  for (const r of sorted) {
    const node = map.get(r.eventId) as Building;
    if (r.causationId === null) {
      roots.push(node);
      continue;
    }
    const parent = map.get(r.causationId);
    if (parent === undefined) {
      node.externalCause = r.causationId;
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  for (const node of map.values()) node.children.sort(byOrder);
  roots.sort(byOrder);
  return roots as unknown as TraceForest;
}
