// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * PostgreSQL adapter for the Mark (ADR-0002).
 *
 * The event store is a single append-only table: `global_seq BIGSERIAL` gives a
 * total order across all objects, `UNIQUE (object_id, seq)` gives per-object
 * monotonic ordering and a hard concurrency backstop. Append-only is enforced
 * in the database itself — a trigger rejects every UPDATE, DELETE, and TRUNCATE,
 * so the log cannot be rewritten even by a direct SQL client (ADR-0001).
 *
 * Implements the same `Mark` contract as `InMemoryMark`; the kernel's behaviour
 * is identical, only the durability changes.
 */

import type { Pool, PoolClient } from "pg";
import type { EventMetadata, Json, MarkEvent, RecordedEvent } from "./event.js";
import { applyEvent, replay, type ObjectState } from "./projection.js";
import { ConcurrencyError, type AppendOptions, type Mark } from "./log.js";
import { parseMarkEvent, parseEventMetadata } from "./event-schema.js";
import { migrate, MARK_EVENTS_TABLE } from "./migrations.js";
import { currentVersion as currentSchemaVersion, upcastToCurrent, MARK_VERSIONS } from "./upcasting.js";

// The store's schema and migrations live in ./migrations.ts; re-exported here
// so callers of the Postgres adapter keep a single import surface.
export { migrate, MARK_EVENTS_TABLE };

const DEFAULT_METADATA: EventMetadata = { actor: "system" };

interface EventRow {
  global_seq: string; // bigint comes back as string from pg
  object_id: string;
  seq: number;
  schema_version: number;
  type: string;
  payload: Record<string, Json>;
  metadata: unknown; // validated at the trust boundary, not trusted as-is
  occurred_at: Date;
  recorded_at: Date;
}

/** Split a domain event into its discriminant and the rest (the JSONB payload). */
function toPayload(event: MarkEvent): Record<string, Json> {
  const { type: _type, ...payload } = event;
  return payload as Record<string, Json>;
}

/**
 * Reconstruct a domain event from a stored row: lift it from its stored version
 * to the current one (ADR-0003), then validate the result against the current
 * schema. A malformed payload or a version from the future is rejected here,
 * never folded into state.
 */
function fromRow(type: string, schemaVersion: number, payload: Record<string, Json>): MarkEvent {
  const upcasted = upcastToCurrent(type, schemaVersion, payload, MARK_VERSIONS);
  return parseMarkEvent({ type, ...upcasted });
}

function toRecorded(row: EventRow): RecordedEvent {
  return Object.freeze({
    // global_seq is a monotonic total-order token, NOT a gapless counter:
    // BIGSERIAL is non-transactional, so rejected appends leave gaps. Only its
    // ordering is meaningful. (Number() is exact below 2^53 — ~9e15 events.)
    globalSeq: Number(row.global_seq),
    objectId: row.object_id,
    seq: row.seq,
    // The in-memory event is upcast to current, so it conforms to current.
    schemaVersion: currentSchemaVersion(row.type, MARK_VERSIONS),
    event: fromRow(row.type, row.schema_version, row.payload),
    metadata: parseEventMetadata(row.metadata),
    occurredAt: row.occurred_at.toISOString(),
    recordedAt: row.recorded_at.toISOString(),
  });
}

export class PostgresMark implements Mark {
  constructor(private readonly pool: Pool) {}

  async append(
    objectId: string,
    event: MarkEvent,
    options: AppendOptions = {},
  ): Promise<RecordedEvent> {
    if (event.type === "ObjectCreated" && event.id !== objectId) {
      throw new Error(`ObjectCreated.id "${event.id}" must match the log key "${objectId}"`);
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialise appends per object so the read-validate-insert is atomic. The
      // two-argument form gives a 64-bit lock key (two distinct 32-bit hashes),
      // making cross-object collisions — and the spurious serialisation they
      // cause — negligible. UNIQUE(object_id, seq) remains the hard backstop.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext($1), hashtext('marrow:' || $1))",
        [objectId],
      );

      const current = await this.#loadWithin(client, objectId);
      const currentVersion = current?.version ?? 0;

      if (options.expectedVersion !== undefined && options.expectedVersion !== currentVersion) {
        throw new ConcurrencyError(objectId, options.expectedVersion, currentVersion);
      }

      // Throws if the event is illegal for the object's current state.
      applyEvent(current, event);

      const occurredAt = options.occurredAt ?? new Date().toISOString();
      const metadata = options.metadata ?? DEFAULT_METADATA;
      const { rows } = await client.query<EventRow>(
        `INSERT INTO ${MARK_EVENTS_TABLE}
           (object_id, seq, type, payload, metadata, occurred_at, schema_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING global_seq, object_id, seq, schema_version, type, payload, metadata, occurred_at, recorded_at`,
        [
          objectId,
          currentVersion + 1,
          event.type,
          toPayload(event),
          metadata,
          occurredAt,
          currentSchemaVersion(event.type, MARK_VERSIONS),
        ],
      );

      await client.query("COMMIT");
      return toRecorded(rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      // UNIQUE(object_id, seq) backstop: a lost race on seq is a concurrency conflict.
      if (isUniqueViolation(error)) {
        throw new ConcurrencyError(objectId, options.expectedVersion ?? -1, -1);
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async read(objectId: string): Promise<readonly RecordedEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      `SELECT global_seq, object_id, seq, schema_version, type, payload, metadata, occurred_at, recorded_at
         FROM ${MARK_EVENTS_TABLE}
        WHERE object_id = $1
        ORDER BY seq ASC`,
      [objectId],
    );
    return rows.map(toRecorded);
  }

  async load(objectId: string): Promise<ObjectState | null> {
    const events = await this.read(objectId);
    return events.length === 0 ? null : replay(events.map((r) => r.event));
  }

  async #loadWithin(client: PoolClient, objectId: string): Promise<ObjectState | null> {
    const { rows } = await client.query<EventRow>(
      `SELECT type, payload, schema_version FROM ${MARK_EVENTS_TABLE} WHERE object_id = $1 ORDER BY seq ASC`,
      [objectId],
    );
    if (rows.length === 0) return null;
    return replay(rows.map((r) => fromRow(r.type, r.schema_version, r.payload)));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
