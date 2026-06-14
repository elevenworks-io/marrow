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
import type { Json, MarkEvent } from "./event.js";

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
]);

/**
 * Validate an untrusted `{ type, ...payload }` object and return it as a
 * `MarkEvent`. Throws `ZodError` if it is not a structurally valid event.
 */
export function parseMarkEvent(candidate: unknown): MarkEvent {
  return markEventSchema.parse(candidate) as MarkEvent;
}
