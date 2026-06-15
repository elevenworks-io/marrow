// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The one projection.
 *
 * `applyEvent` folds a single event into object state; `replay` folds an
 * object's whole event sequence from nothing. State is *derived* — a cache of
 * the events, never the authority (ADR-0001). Both functions are pure and
 * return frozen values, so a projected state can never be mistaken for a
 * mutable record you may write to.
 */

import type { Json, MarkEvent } from "./event.js";

/** The current state of an object, projected from its events. */
export interface ObjectState {
  readonly id: string;
  readonly objectType: string;
  readonly attributes: Readonly<Record<string, Json>>;
  readonly state: string | null;
  readonly notes: readonly string[];
  /** Number of events folded into this state — the object's version. */
  readonly version: number;
}

/** Raised when an event sequence cannot be a valid object history. */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/**
 * Fold one event into state. `null` means "no object yet": the first event
 * must be `ObjectCreated`, and only the first. The switch is exhaustive — the
 * `never` arm makes an unhandled event type a compile error.
 */
export function applyEvent(state: ObjectState | null, event: MarkEvent): ObjectState {
  if (event.type === "ObjectCreated") {
    if (state !== null) {
      throw new ReplayError(
        `ObjectCreated for "${event.id}" applied to an object that already exists`,
      );
    }
    return Object.freeze({
      id: event.id,
      objectType: event.objectType,
      attributes: Object.freeze({}),
      state: null,
      notes: Object.freeze([]),
      version: 1,
    });
  }

  if (state === null) {
    throw new ReplayError(`"${event.type}" applied before the object was created`);
  }

  // Each arm returns a complete, frozen state literal: no projection can ever
  // leave this function mutable, and the compiler checks the union is total.
  const version = state.version + 1;
  switch (event.type) {
    case "AttributeSet":
      return Object.freeze({
        ...state,
        attributes: Object.freeze({ ...state.attributes, [event.key]: event.value }),
        version,
      });
    case "StateChanged":
      return Object.freeze({ ...state, state: event.state, version });
    case "NoteAdded":
      return Object.freeze({ ...state, notes: Object.freeze([...state.notes, event.text]), version });
    case "DecisionProposed":
    case "ConfidenceAssessed":
    case "Acted":
    case "Escalated":
    case "OutcomeObserved":
      // Agent decision-chain events (ADR-0010) live on the object's stream but
      // are not domain mutations: a separate projection (replayDecision) folds
      // them, keyed by correlationId. Here they only advance the version, so
      // ObjectState stays field-clean (ADR-0004: decision/cross-object read
      // models are their own named projections, not facets of ObjectState).
      return Object.freeze({ ...state, version });
    default: {
      const unreachable: never = event;
      throw new ReplayError(`unknown event type: ${JSON.stringify(unreachable)}`);
    }
  }
}

/**
 * Reconstruct an object's current state purely from its events, in order.
 * Throws if the sequence is empty or does not begin with `ObjectCreated`.
 */
export function replay(events: readonly MarkEvent[]): ObjectState {
  let state: ObjectState | null = null;
  for (const event of events) {
    state = applyEvent(state, event);
  }
  if (state === null) {
    throw new ReplayError("cannot replay an empty event sequence: no object");
  }
  return state;
}
