// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Numbered, ordered schema migrations for the Mark's PostgreSQL store.
 *
 * The kernel's single idempotent `migrate()` is no longer enough once the
 * schema evolves (ADR-0003 / the capability map deferral). Migrations are an
 * append-only, ordered list: each runs once, in version order, inside its own
 * transaction, and is recorded in `schema_migrations`. Migrations are never
 * edited or reordered after they ship — a schema change is a *new* migration,
 * mirroring how events themselves evolve.
 */

import type { Pool, PoolClient } from "pg";

export const MARK_EVENTS_TABLE = "mark_events";
export const MIGRATIONS_TABLE = "schema_migrations";

/** Advisory-lock key (ASCII "MARK") serialising the migration run across instances. */
const MIGRATION_LOCK_KEY = 0x4d41524b;

/** One ordered, run-once schema change. */
export interface Migration {
  readonly version: number;
  readonly name: string;
  up(client: PoolClient): Promise<void>;
}

/** Migration 1 — the kernel: the append-only event store and its guards. */
const m0001_kernel: Migration = {
  version: 1,
  name: "kernel_event_store",
  async up(client) {
    await client.query(`
      CREATE TABLE ${MARK_EVENTS_TABLE} (
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

      -- Row-level guard for UPDATE/DELETE. References only TG_OP, never NEW/OLD.
      CREATE OR REPLACE FUNCTION ${MARK_EVENTS_TABLE}_no_mutate_fn()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'the Mark is append-only: % on ${MARK_EVENTS_TABLE} is forbidden', TG_OP;
        END;
      $$ LANGUAGE plpgsql;

      -- Separate statement-level guard for TRUNCATE (no NEW/OLD in that context).
      CREATE OR REPLACE FUNCTION ${MARK_EVENTS_TABLE}_no_truncate_fn()
        RETURNS trigger AS $$
        BEGIN
          RAISE EXCEPTION 'the Mark is append-only: TRUNCATE on ${MARK_EVENTS_TABLE} is forbidden';
        END;
      $$ LANGUAGE plpgsql;

      CREATE TRIGGER ${MARK_EVENTS_TABLE}_no_mutate
        BEFORE UPDATE OR DELETE ON ${MARK_EVENTS_TABLE}
        FOR EACH ROW EXECUTE FUNCTION ${MARK_EVENTS_TABLE}_no_mutate_fn();

      CREATE TRIGGER ${MARK_EVENTS_TABLE}_no_truncate
        BEFORE TRUNCATE ON ${MARK_EVENTS_TABLE}
        FOR EACH STATEMENT EXECUTE FUNCTION ${MARK_EVENTS_TABLE}_no_truncate_fn();
    `);
  },
};

/**
 * Migration 2 — record each event's schema version (ADR-0003). Existing rows
 * predate versioning and are therefore version 1; the default backfills them.
 */
const m0002_event_schema_version: Migration = {
  version: 2,
  name: "event_schema_version",
  async up(client) {
    await client.query(
      `ALTER TABLE ${MARK_EVENTS_TABLE} ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1`,
    );
  },
};

/**
 * Migration 3 — causal lineage (ADR-0009 glass-box chains). `event_id` is the
 * stable per-event anchor (existing rows get a generated uuid). `correlation_id`
 * and `causation_id` are nullable: a NULL correlation is read as the event's own
 * id (a root), so no backfill UPDATE is needed — which the append-only trigger
 * would forbid anyway. (`gen_random_uuid()` is a core function since Postgres 13,
 * which is our floor.)
 */
const m0003_event_lineage: Migration = {
  version: 3,
  name: "event_lineage",
  async up(client) {
    await client.query(`
      ALTER TABLE ${MARK_EVENTS_TABLE}
        ADD COLUMN event_id       TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        ADD COLUMN correlation_id TEXT,
        ADD COLUMN causation_id   TEXT;

      CREATE INDEX ${MARK_EVENTS_TABLE}_correlation_idx ON ${MARK_EVENTS_TABLE} (correlation_id);
      CREATE INDEX ${MARK_EVENTS_TABLE}_causation_idx   ON ${MARK_EVENTS_TABLE} (causation_id);
    `);
  },
};

/**
 * Migration 4 — idempotency keys (ADR-0007). A nullable column with a partial
 * unique index scoped to the object: many events have no key, but any key that
 * is present is unique *per object*, so a retried append to that object
 * deduplicates rather than double-writes, while the same key on a different
 * object is a distinct operation (and composes with future per-tenant scoping).
 */
const m0004_idempotency_key: Migration = {
  version: 4,
  name: "idempotency_key",
  async up(client) {
    await client.query(`
      ALTER TABLE ${MARK_EVENTS_TABLE} ADD COLUMN idempotency_key TEXT;
      CREATE UNIQUE INDEX ${MARK_EVENTS_TABLE}_idempotency_key_uidx
        ON ${MARK_EVENTS_TABLE} (object_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;
    `);
  },
};

/** The ordered migration list. Append new migrations; never edit shipped ones. */
export const MIGRATIONS: readonly Migration[] = [
  m0001_kernel,
  m0002_event_schema_version,
  m0003_event_lineage,
  m0004_idempotency_key,
];

/**
 * Apply all pending migrations in version order. Each runs in its own
 * transaction and is recorded in `schema_migrations`; already-applied
 * migrations are skipped, so this is safe to run on every startup. A session
 * advisory lock serialises the whole run so concurrent cold-starting instances
 * don't race to apply the same migration.
 */
export async function migrate(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Session-scoped lock: serialises concurrent runs. If the process is killed
    // mid-run the lock releases only when the backend session is reaped, so
    // other instances may block briefly — acceptable, and the `applied` set
    // makes re-running safe regardless.
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: number }>(
      `SELECT version FROM ${MIGRATIONS_TABLE}`,
    );
    const applied = new Set(rows.map((r) => r.version));

    for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
      if (applied.has(migration.version)) continue;
      try {
        await client.query("BEGIN");
        await migration.up(client);
        await client.query(
          `INSERT INTO ${MIGRATIONS_TABLE} (version, name) VALUES ($1, $2)`,
          [migration.version, migration.name],
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
    client.release();
  }
}
