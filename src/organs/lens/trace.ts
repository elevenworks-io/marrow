// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 — the trace projection. Folds an event stream into a causal forest
 * (keyed by causationId, objectId-agnostic) plus a one-line summary per event.
 * A pure function of the events: no persistence, no second source of truth —
 * the trace IS the events (VISION §3.1, ADR-0009/0004).
 */

import type { Json, MarkEvent } from "../../mark/index.js";

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
