// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { migrate, MIGRATIONS, MARK_EVENTS_TABLE, MIGRATIONS_TABLE } from "./migrations.js";

const url = process.env.MARROW_TEST_DATABASE_URL;

describe.skipIf(!url)("migrate", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: url });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${MARK_EVENTS_TABLE} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS ${MIGRATIONS_TABLE} CASCADE`);
  });

  it("applies every migration in order and records it", async () => {
    await migrate(pool);
    const { rows } = await pool.query(
      `SELECT version FROM ${MIGRATIONS_TABLE} ORDER BY version`,
    );
    expect(rows.map((r) => r.version)).toEqual(MIGRATIONS.map((m) => m.version));
  });

  it("creates the append-only mark_events table (migration 1)", async () => {
    await migrate(pool);
    const { rows } = await pool.query(`SELECT to_regclass('${MARK_EVENTS_TABLE}') AS t`);
    expect(rows[0].t).toBe(MARK_EVENTS_TABLE);
  });

  it("is idempotent — running twice applies nothing new and does not error", async () => {
    await migrate(pool);
    await migrate(pool);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${MIGRATIONS_TABLE}`);
    expect(rows[0].n).toBe(MIGRATIONS.length);
  });

  it("applies only pending migrations on a partially-migrated database", async () => {
    // Apply just the first migration by hand, then let migrate() do the rest.
    await pool.query(
      `CREATE TABLE ${MIGRATIONS_TABLE} (
         version INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
       )`,
    );
    const first = MIGRATIONS[0]!;
    const client = await pool.connect();
    try {
      await first.up(client);
      await client.query(`INSERT INTO ${MIGRATIONS_TABLE} (version, name) VALUES ($1, $2)`, [
        first.version,
        first.name,
      ]);
    } finally {
      client.release();
    }

    await migrate(pool);

    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${MIGRATIONS_TABLE}`);
    expect(rows[0].n).toBe(MIGRATIONS.length);
  });
});
