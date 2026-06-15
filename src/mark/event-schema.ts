// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Runtime validation for events at a trust boundary (ADR-0002).
 *
 * TypeScript types are erased at runtime, so anything deserialised from storage
 * — where a buggy writer, a direct SQL insert, or schema drift could produce a
 * structurally invalid event — must be validated before it is trusted as a
 * `MarkEvent`. An unchecked cast there would let an event with, say, a missing
 * `id` reach the projection and silently break `load == replay(read)`.
 */

import { z } from "zod";
import type { EventMetadata, Json, MarkEvent } from "./event.js";

const jsonSchema: z.ZodType<Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);

/** The canonical shape of every `MarkEvent` variant, enforced at runtime. */
export const markEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ObjectCreated"), id: z.string(), objectType: z.string() }).strict(),
  z.object({ type: z.literal("AttributeSet"), key: z.string(), value: jsonSchema }).strict(),
  z.object({ type: z.literal("StateChanged"), state: z.string() }).strict(),
  z.object({ type: z.literal("NoteAdded"), text: z.string() }).strict(),
  z.object({
    type: z.literal("DecisionProposed"),
    draft: z.string(),
    perceivedObjectId: z.string(),
    perceivedSeq: z.number(),
  }).strict(),
  z.object({
    type: z.literal("ConfidenceAssessed"),
    confidence: z.number(),
    threshold: z.number(),
    tier: z.enum(["T1", "T2", "T3", "T4"]),
  }).strict(),
  z.object({ type: z.literal("Acted"), draftRef: z.string() }).strict(),
  z.object({ type: z.literal("Escalated"), reason: z.string() }).strict(),
  z.object({
    type: z.literal("OutcomeObserved"),
    wasCorrect: z.boolean(),
    evidence: z.string().nullable(),
  }).strict(),
]);

/**
 * The glass-box audit envelope, enforced at runtime. `actor` is required — an
 * event with no cause cannot reconstruct "why". Known fields are typed
 * strictly; `passthrough` keeps any additional audit context (richer reasoning,
 * structured tool traces) rather than discarding or rejecting it, since the
 * glass-box record is deliberately open-ended.
 */
export const eventMetadataSchema = z
  .object({
    actor: z.string(),
    reason: z.string().optional(),
    confidence: z.number().optional(),
    tools: z.array(z.string()).optional(),
  })
  .passthrough();

/**
 * Validate an untrusted `{ type, ...payload }` object and return it as a
 * `MarkEvent`. Throws `ZodError` if it is not a structurally valid event.
 */
export function parseMarkEvent(candidate: unknown): MarkEvent {
  return markEventSchema.parse(candidate) as MarkEvent;
}

/**
 * Validate untrusted metadata and return it as `EventMetadata`. Throws
 * `ZodError` if `actor` is missing or a known field has the wrong type.
 */
export function parseEventMetadata(candidate: unknown): EventMetadata {
  return eventMetadataSchema.parse(candidate) as EventMetadata;
}
