// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Mark — the append-only event log.
 *
 * The log is keyed by object id and assigns a per-object monotonic `seq` plus a
 * global total-order `globalSeq`. It is append-only: there is no update or
 * delete. Every append is validated against the object's current projection —
 * the log accepts only events that keep the history legally replayable
 * (ADR-0001: events are truth; an illegal event must never enter).
 *
 * `Mark` is the storage interface; `InMemoryMark` is the reference adapter used
 * to prove the kernel. The PostgreSQL adapter (ADR-0002) implements the same
 * contract against an append-only table.
 */

import { randomUUID } from "node:crypto";
import type { EventMetadata, MarkEvent, RecordedEvent } from "./event.js";
import { applyEvent, replay, type ObjectState } from "./projection.js";
import { currentVersion as currentSchemaVersion, MARK_VERSIONS } from "./upcasting.js";

/** The causing event of an append — enough to inherit its lineage. */
export interface CausedBy {
  readonly eventId: string;
  readonly correlationId: string;
}

/** Resolve an event's lineage: a caused event inherits the correlation and
 *  points causation at its cause; a root event is its own correlation. */
export function resolveLineage(
  eventId: string,
  causedBy: CausedBy | undefined,
): { correlationId: string; causationId: string | null } {
  return causedBy
    ? { correlationId: causedBy.correlationId, causationId: causedBy.eventId }
    : { correlationId: eventId, causationId: null };
}

/** Raised when an append's `expectedVersion` does not match current version. */
export class ConcurrencyError extends Error {
  constructor(
    readonly objectId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `optimistic concurrency conflict on "${objectId}": expected version ` +
        `${expectedVersion}, found ${actualVersion}`,
    );
    this.name = "ConcurrencyError";
  }
}

/** Options for a single append. */
export interface AppendOptions {
  readonly metadata?: EventMetadata;
  /**
   * Optimistic concurrency guard: the object's current version the caller
   * believes it is extending. 0 means "I expect this object not to exist yet".
   */
  readonly expectedVersion?: number;
  /** When the event actually happened, if not "now" (ISO 8601). */
  readonly occurredAt?: string;
  /** The event that caused this one — its lineage is inherited (glass-box). */
  readonly causedBy?: CausedBy;
}

/** The append-only event log. */
export interface Mark {
  append(objectId: string, event: MarkEvent, options?: AppendOptions): Promise<RecordedEvent>;
  read(objectId: string): Promise<readonly RecordedEvent[]>;
  load(objectId: string): Promise<ObjectState | null>;
  /** Every event of a case (shared correlation), in global order — the chain
   *  that reconstructs *why* (ADR-0009). */
  readCorrelation(correlationId: string): Promise<readonly RecordedEvent[]>;
}

const DEFAULT_METADATA: EventMetadata = { actor: "system" };

/** In-memory reference implementation of the Mark. */
export class InMemoryMark implements Mark {
  readonly #byObject = new Map<string, RecordedEvent[]>();
  readonly #log: RecordedEvent[] = [];
  #globalSeq = 0;

  async append(
    objectId: string,
    event: MarkEvent,
    options: AppendOptions = {},
  ): Promise<RecordedEvent> {
    const existing = this.#byObject.get(objectId) ?? [];
    const current = foldOrNull(existing);
    const currentVersion = current?.version ?? 0;

    if (event.type === "ObjectCreated" && event.id !== objectId) {
      throw new Error(
        `ObjectCreated.id "${event.id}" must match the log key "${objectId}"`,
      );
    }

    if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
      throw new ConcurrencyError(objectId, options.expectedVersion, currentVersion);
    }

    // Validate against the projection: this throws if the event is illegal for
    // the object's current state (e.g. created twice, or mutated before created).
    applyEvent(current, event);

    const eventId = randomUUID();
    const { correlationId, causationId } = resolveLineage(eventId, options.causedBy);
    const recorded: RecordedEvent = Object.freeze({
      eventId,
      correlationId,
      causationId,
      globalSeq: ++this.#globalSeq,
      objectId,
      seq: currentVersion + 1,
      schemaVersion: currentSchemaVersion(event.type, MARK_VERSIONS),
      event,
      metadata: options.metadata ?? DEFAULT_METADATA,
      occurredAt: options.occurredAt ?? new Date().toISOString(),
      recordedAt: new Date().toISOString(),
    });

    // Distinguish "map had no entry" from "object has no events" — never use
    // array length as a presence proxy.
    let stored = this.#byObject.get(objectId);
    if (stored === undefined) {
      stored = [];
      this.#byObject.set(objectId, stored);
    }
    stored.push(recorded);
    this.#log.push(recorded);
    return recorded;
  }

  async read(objectId: string): Promise<readonly RecordedEvent[]> {
    return [...(this.#byObject.get(objectId) ?? [])];
  }

  async load(objectId: string): Promise<ObjectState | null> {
    const events = this.#byObject.get(objectId);
    if (events === undefined || events.length === 0) {
      return null;
    }
    return replay(events.map((r) => r.event));
  }

  async readCorrelation(correlationId: string): Promise<readonly RecordedEvent[]> {
    // #log is already in global (append) order.
    return this.#log.filter((r) => r.correlationId === correlationId);
  }
}

/** Fold stored events into state, or null if the object has no events yet. */
function foldOrNull(events: readonly RecordedEvent[]): ObjectState | null {
  return events.length === 0 ? null : replay(events.map((r) => r.event));
}
