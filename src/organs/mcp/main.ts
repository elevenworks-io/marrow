// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Runnable entry point: the Mark as a stdio MCP server, ready for an assistant
 * to connect to (ADR-0006). Point Claude Desktop / the `claude` CLI at:
 *
 *   command: npm   args: ["--silent", "run", "mcp"]   cwd: <this repo>
 *   env: { MARROW_DATABASE_URL: "postgres://…", MARROW_MCP_ACTOR: "mcp:claude" }
 *
 * With a database it persists to PostgreSQL; without one it runs on an in-memory
 * Mark (handy for a quick try, but nothing is kept).
 *
 * NB: on stdio the protocol owns stdout — all human-facing logging goes to stderr.
 */

import { Pool } from "pg";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { InMemoryMark, PostgresMark, migrate, type Mark } from "../../mark/index.js";
import { createMarkMcpServer } from "./server.js";

async function buildMark(): Promise<Mark> {
  const url = process.env.MARROW_DATABASE_URL ?? process.env.MARROW_TEST_DATABASE_URL;
  if (url === undefined) {
    console.error("[marrow] no MARROW_DATABASE_URL — using an in-memory Mark (not persisted).");
    return new InMemoryMark();
  }
  // statement_timeout bounds the currently-unbounded reads (capability map).
  const pool = new Pool({ connectionString: url, statement_timeout: 30_000 });
  await migrate(pool);
  console.error("[marrow] connected to PostgreSQL; schema migrated.");
  return new PostgresMark(pool);
}

async function main(): Promise<void> {
  const actor = process.env.MARROW_MCP_ACTOR ?? "mcp:assistant";
  const mark = await buildMark();
  const server = createMarkMcpServer(mark, actor);
  await server.connect(new StdioServerTransport());
  console.error(`[marrow] Mark MCP server ready (actor: ${actor}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
