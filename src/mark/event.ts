// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Mark — typed, immutable events.
 *
 * Per ADR-0001, events are the single source of truth: every perception,
 * decision, action, and state change is recorded as one immutable event.
 * Current state is a *projection* folded from these (see `projection.ts`),
 * never an authoritative mutable record.
 *
 * `MarkEvent` is a discriminated union on `type`. A handful of event types is
 * enough to prove the kernel (CLAUDE.md, "Current state"). The union is folded
 * exhaustively by the projection; adding a variant forces the projection to
 * handle it (a `never`-check makes the omission a compile error).
 */

/** A JSON value — the only thing that may live in an event payload. */
export type Json =
  | string
  | number
  | boolean
  | null
  | readonly Json[]
  | { readonly [key: string]: Json };

/** The action-risk tier that sets the autonomy floor (ADR-0010). */
export type ActionTier = "T1" | "T2" | "T3" | "T4";

/** The domain event: *what happened* to an object. */
export type MarkEvent =
  | { readonly type: "ObjectCreated"; readonly id: string; readonly objectType: string }
  | { readonly type: "AttributeSet"; readonly key: string; readonly value: Json }
  | { readonly type: "StateChanged"; readonly state: string }
  | { readonly type: "NoteAdded"; readonly text: string }
  // Agent decision chain (ADR-0010), recorded on the acted-upon object's stream.
  | {
      readonly type: "DecisionProposed";
      readonly draft: string;
      readonly perceivedObjectId: string;
      readonly perceivedSeq: number;
    }
  | {
      readonly type: "ConfidenceAssessed";
      readonly confidence: number;
      readonly threshold: number;
      readonly tier: ActionTier;
    }
  | { readonly type: "Acted"; readonly draftRef: string }
  | { readonly type: "Escalated"; readonly reason: string }
  | { readonly type: "OutcomeObserved"; readonly wasCorrect: boolean; readonly evidence: string | null };

/** The discriminant values of `MarkEvent`, for narrowing and validation. */
export type MarkEventType = MarkEvent["type"];

/**
 * Glass-box envelope metadata (VISION §3.2): enough to reconstruct *why* an
 * event happened. `actor` is mandatory — every event has a cause. Reasoning,
 * confidence, and the tools called are optional here but are what makes an
 * autonomous action auditable from the substrate alone.
 */
export interface EventMetadata {
  readonly actor: string;
  readonly reason?: string;
  readonly confidence?: number;
  readonly tools?: readonly string[];
}

/**
 * An event as stored in the Mark: the domain event plus its append-only
 * envelope. `globalSeq` is the total order across all objects; `seq` is the
 * per-object monotonic sequence (starts at 1). Both are assigned by the log on
 * append, never by the caller.
 */
export interface RecordedEvent {
  /** Stable, unique id of this event — the anchor for causal lineage. */
  readonly eventId: string;
  /** The root that ties a whole decision chain ("case") together. A root event
   *  is its own correlation. */
  readonly correlationId: string;
  /** The event that directly caused this one; `null` for a root event. */
  readonly causationId: string | null;
  readonly globalSeq: number;
  readonly objectId: string;
  readonly seq: number;
  /** The schema version the in-memory `event` conforms to (the current version
   *  of its type — an older stored event is upcast to current on read). */
  readonly schemaVersion: number;
  readonly event: MarkEvent;
  readonly metadata: EventMetadata;
  readonly occurredAt: string;
  readonly recordedAt: string;
}
