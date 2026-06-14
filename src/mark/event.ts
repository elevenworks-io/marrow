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

/** The domain event: *what happened* to an object. */
export type MarkEvent =
  | { readonly type: "ObjectCreated"; readonly id: string; readonly objectType: string }
  | { readonly type: "AttributeSet"; readonly key: string; readonly value: Json }
  | { readonly type: "StateChanged"; readonly state: string }
  | { readonly type: "NoteAdded"; readonly text: string };

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
  readonly globalSeq: number;
  readonly objectId: string;
  readonly seq: number;
  readonly event: MarkEvent;
  readonly metadata: EventMetadata;
  readonly occurredAt: string;
  readonly recordedAt: string;
}
