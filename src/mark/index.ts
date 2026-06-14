// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Mark — MARROW's spine. The append-only event-sourced substrate that is
 * the single source of truth (ADR-0001). Everything else is an organ attached
 * to this. This barrel is the kernel's public surface.
 */

export type { Json, MarkEvent, MarkEventType, EventMetadata, RecordedEvent } from "./event.js";
export { type ObjectState, applyEvent, replay, ReplayError } from "./projection.js";
export { type Mark, type AppendOptions, InMemoryMark, ConcurrencyError } from "./log.js";
