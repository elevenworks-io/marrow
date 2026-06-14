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

export const MARK_EVENTS_TABLE = "mark_events";

const DEFAULT_METADATA: EventMetadata = { actor: "system" };

/** Idempotently create the append-only event store and its guards. */
export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MARK_EVENTS_TABLE} (
      global_seq  BIGSERIAL PRIMARY KEY,
      object_id   TEXT        NOT NULL,
      seq         INTEGER     NOT NULL,
      type        TEXT        NOT NULL,
      payload     JSONB       NOT NULL,
      metadata    JSONB       NOT NULL,
      occurred_at TIMESTAMPTZ NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (object_id, seq)
    );

    CREATE OR REPLACE FUNCTION ${MARK_EVENTS_TABLE}_append_only()
      RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'the Mark is append-only: % on ${MARK_EVENTS_TABLE} is forbidden', TG_OP;
      END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS ${MARK_EVENTS_TABLE}_no_mutate ON ${MARK_EVENTS_TABLE};
    CREATE TRIGGER ${MARK_EVENTS_TABLE}_no_mutate
      BEFORE UPDATE OR DELETE ON ${MARK_EVENTS_TABLE}
      FOR EACH ROW EXECUTE FUNCTION ${MARK_EVENTS_TABLE}_append_only();

    DROP TRIGGER IF EXISTS ${MARK_EVENTS_TABLE}_no_truncate ON ${MARK_EVENTS_TABLE};
    CREATE TRIGGER ${MARK_EVENTS_TABLE}_no_truncate
      BEFORE TRUNCATE ON ${MARK_EVENTS_TABLE}
      FOR EACH STATEMENT EXECUTE FUNCTION ${MARK_EVENTS_TABLE}_append_only();
  `);
}

interface EventRow {
  global_seq: string; // bigint comes back as string from pg
  object_id: string;
  seq: number;
  type: string;
  payload: Record<string, Json>;
  metadata: EventMetadata;
  occurred_at: Date;
  recorded_at: Date;
}

const KNOWN_TYPES = new Set<MarkEvent["type"]>([
  "ObjectCreated",
  "AttributeSet",
  "StateChanged",
  "NoteAdded",
]);

/** Split a domain event into its discriminant and the rest (the JSONB payload). */
function toPayload(event: MarkEvent): Record<string, Json> {
  const { type: _type, ...payload } = event;
  return payload as Record<string, Json>;
}

/** Reconstruct a domain event from a stored row, guarding against schema drift. */
function fromRow(type: string, payload: Record<string, Json>): MarkEvent {
  if (!KNOWN_TYPES.has(type as MarkEvent["type"])) {
    throw new Error(`unknown event type read from the Mark: ${type}`);
  }
  return { type, ...payload } as MarkEvent;
}

function toRecorded(row: EventRow): RecordedEvent {
  return Object.freeze({
    globalSeq: Number(row.global_seq),
    objectId: row.object_id,
    seq: row.seq,
    event: fromRow(row.type, row.payload),
    metadata: row.metadata,
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
      // Serialise appends per object so the read-validate-insert is atomic.
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [objectId]);

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
           (object_id, seq, type, payload, metadata, occurred_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING global_seq, object_id, seq, type, payload, metadata, occurred_at, recorded_at`,
        [objectId, currentVersion + 1, event.type, toPayload(event), metadata, occurredAt],
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
      `SELECT global_seq, object_id, seq, type, payload, metadata, occurred_at, recorded_at
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
      `SELECT type, payload FROM ${MARK_EVENTS_TABLE} WHERE object_id = $1 ORDER BY seq ASC`,
      [objectId],
    );
    if (rows.length === 0) return null;
    return replay(rows.map((r) => fromRow(r.type, r.payload)));
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}
