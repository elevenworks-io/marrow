// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Event versioning by upcasting on read (ADR-0003).
 *
 * Stored events are immutable and carry the `schemaVersion` they were written
 * with. When a breaking change ships, the event type's current version is
 * bumped and an upcaster `vN -> vN+1` is registered. On read, an old event is
 * lifted through the chain to the current shape before it is folded, so
 * projections only ever see the latest form. We never rewrite stored events
 * (in-store migration would break the append-only invariant and the audit /
 * Time Machine).
 */

import type { Json, MarkEventType } from "./event.js";

/** Converts a payload from one version to the next. Pure. */
export type EventUpcaster = (payload: Record<string, Json>) => Record<string, Json>;

/** The current version per event type, and the upcaster chain to reach it. */
export interface VersionRegistry {
  /** Event type -> its current schema version. */
  readonly current: Readonly<Record<string, number>>;
  /** Event type -> { fromVersion -> upcaster to fromVersion+1 }. */
  readonly upcasters: Readonly<Record<string, Readonly<Record<number, EventUpcaster>>>>;
}

/** Raised when an event cannot be lifted to the current version. */
export class UpcastError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpcastError";
  }
}

/** The current schema version of an event type. Throws for unknown types. */
export function currentVersion(type: string, registry: VersionRegistry): number {
  const version = registry.current[type];
  if (version === undefined) {
    throw new UpcastError(`unknown event type: ${type}`);
  }
  return version;
}

/**
 * Lift a stored payload from `fromVersion` to the type's current version by
 * applying each registered upcaster in turn. A no-op when already current.
 */
export function upcastToCurrent(
  type: string,
  fromVersion: number,
  payload: Record<string, Json>,
  registry: VersionRegistry,
): Record<string, Json> {
  const target = currentVersion(type, registry);
  if (fromVersion > target) {
    throw new UpcastError(
      `event "${type}" is version ${fromVersion}, newer than the current ${target} — from the future`,
    );
  }

  let version = fromVersion;
  let current = payload;
  while (version < target) {
    const upcaster = registry.upcasters[type]?.[version];
    if (upcaster === undefined) {
      throw new UpcastError(`no upcaster for "${type}" v${version} -> v${version + 1}`);
    }
    current = upcaster(current);
    version += 1;
  }
  return current;
}

/**
 * The Mark's own event versions. Every kernel event type starts at version 1
 * with no upcasters; a breaking change bumps `current` and adds the `vN -> vN+1`
 * function here.
 */
// `satisfies` makes a new MarkEvent type without a registered version a compile
// error — every event type must declare its current version.
const MARK_CURRENT = {
  ObjectCreated: 1,
  AttributeSet: 1,
  StateChanged: 1,
  NoteAdded: 1,
} satisfies Record<MarkEventType, number>;

export const MARK_VERSIONS: VersionRegistry = {
  current: MARK_CURRENT,
  upcasters: {},
};
