// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * A guided, visual tour of the Mark — run it and watch the substrate prove
 * itself, step by step, on real data.
 *
 *   npm run tour
 *
 * The append-only-database section also needs a Postgres (it's skipped without
 * one):
 *
 *   MARROW_TEST_DATABASE_URL=postgres://postgres:marrow@127.0.0.1:55432/marrow_test npm run tour
 */

import { Pool } from "pg";
import {
  InMemoryMark,
  applyEvent,
  upcastToCurrent,
  type MarkEvent,
  type ObjectState,
  type RecordedEvent,
  type VersionRegistry,
  migrate,
  MARK_EVENTS_TABLE,
  PostgresMark,
} from "../src/mark/index.js";

// ── tiny terminal styling (degrades to plain text if NO_COLOR is set) ─────────
const useColor = !process.env.NO_COLOR;
const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const cyan = sgr("36");
const green = sgr("32");
const yellow = sgr("33");
const red = sgr("31");
const check = green("✓");

function header(n: string, title: string): void {
  console.log("");
  console.log(cyan(bold(`${n}  ${title}`)));
  console.log(cyan("─".repeat(64)));
}

function banner(): void {
  const line = "═".repeat(64);
  console.log(cyan(`╔${line}╗`));
  console.log(cyan("║ ") + bold("THE MARK — a guided tour") + cyan(" ".repeat(38) + "║"));
  console.log(
    cyan("║ ") + dim("Everything is an event. State is computed, never stored.") + cyan("   ║"),
  );
  console.log(cyan(`╚${line}╝`));
}

const j = (v: unknown) => JSON.stringify(v);

async function main(): Promise<void> {
  banner();

  // ───────────────────────────────────────────────────────────────────────────
  header("①", "A support ticket lives its whole life — as events");
  console.log(dim("   We never edit a 'ticket row'. We only record what happened.\n"));

  const mark = new InMemoryMark();
  const ticket = "ticket-1042";

  // The life of the ticket, as a sequence of immutable events.
  const life: MarkEvent[] = [
    { type: "ObjectCreated", id: ticket, objectType: "ticket" },
    { type: "AttributeSet", key: "subject", value: "Burst pipe at 23:40" },
    { type: "AttributeSet", key: "priority", value: "emergency" },
    { type: "StateChanged", state: "open" },
    { type: "NoteAdded", text: "Dispatched on-call technician" },
    { type: "StateChanged", state: "resolved" },
  ];

  for (const event of life) {
    await mark.append(ticket, event, {
      metadata: { actor: "agent:cortex", reason: "intake → triage", confidence: 0.94 },
    });
    console.log(`   ${green("▸")} ${bold(event.type.padEnd(14))} ${dim(j(detail(event)))}`);
  }
  console.log(`\n   ${dim(`The Mark stored ${life.length} immutable events. Nothing was overwritten.`)}`);

  // ───────────────────────────────────────────────────────────────────────────
  header("②", "Where is the 'current ticket' stored?  Nowhere — it's folded");
  console.log(dim("   Watch the state being BUILT by replaying the events one by one:\n"));

  let state: ObjectState | null = null;
  console.log(`   ${dim("start".padEnd(26))} ${j({})}`);
  for (const event of life) {
    state = applyEvent(state, event);
    console.log(`   ${green("+")} ${event.type.padEnd(24)} ${dim("→")} ${summ(state)}`);
  }
  console.log(`\n   ${bold("= the current ticket")}, computed — not a stored row.`);

  // ───────────────────────────────────────────────────────────────────────────
  header("③", "Proof: the state is NOTHING BUT a fold of the log");
  const read = await mark.read(ticket);
  const loaded = await mark.load(ticket);
  const replayed = read.reduce<ObjectState | null>((s, r) => applyEvent(s, r.event), null);
  const identical = j(loaded) === j(replayed);
  console.log(`   load(id)              = ${summ(loaded)}`);
  console.log(`   replay(read(id))      = ${summ(replayed)}`);
  console.log(
    `\n   ${identical ? check : red("✗")} ${bold("load(id) === replay(read(id))")} ` +
      dim("— rebuilding from scratch gives the identical state."),
  );

  // ───────────────────────────────────────────────────────────────────────────
  header("④", "Glass-box: every event remembers WHY it happened");
  console.log(dim("   A small 'case' where each step is caused by the one before it:\n"));

  const caseMark = new InMemoryMark();
  const root = await caseMark.append(
    "case-7",
    { type: "ObjectCreated", id: "case-7", objectType: "complaint" },
    { metadata: { actor: "channel:email" } },
  );
  const classified = await caseMark.append(
    "case-7",
    { type: "AttributeSet", key: "category", value: "refund > €500" },
    { causedBy: root, metadata: { actor: "agent:cortex", reason: "classified intake", confidence: 0.88 } },
  );
  await caseMark.append(
    "case-7",
    { type: "StateChanged", state: "escalated-to-human" },
    { causedBy: classified, metadata: { actor: "agent:cortex", reason: "refund over threshold → gate", confidence: 0.91 } },
  );

  const chain = await caseMark.readCorrelation(root.correlationId);
  printChain(chain);
  console.log(
    `\n   ${check} ${dim("readCorrelation() walked the whole case across the log, in order.")}`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  header("⑤", "Idempotent: clicking 'submit' twice still records ONE event");
  const dedupeMark = new InMemoryMark();
  await dedupeMark.append("order-9", { type: "ObjectCreated", id: "order-9", objectType: "order" });
  const first = await dedupeMark.append(
    "order-9",
    { type: "NoteAdded", text: "payment captured" },
    { idempotencyKey: "capture-42" },
  );
  const retry = await dedupeMark.append(
    "order-9",
    { type: "NoteAdded", text: "payment captured" },
    { idempotencyKey: "capture-42" },
  );
  const count = (await dedupeMark.read("order-9")).length;
  console.log(`   first append  → event ${dim(first.eventId.slice(0, 8))}`);
  console.log(`   retry append  → event ${dim(retry.eventId.slice(0, 8))}  ${dim("(same key)")}`);
  console.log(
    `\n   ${first.eventId === retry.eventId ? check : red("✗")} ` +
      `same key returns the same event — ${bold(`${count} events`)}, not ${count + 1}.`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  header("⑥", "Future-proof: an old event still replays years later");
  console.log(dim("   Schemas evolve. Old events are lifted to today's shape on read,\n   never rewritten. Here a v1 event is upcast through to v3:\n"));
  const registry: VersionRegistry = {
    current: { Note: 3 },
    upcasters: {
      Note: {
        1: (p) => ({ ...p, pinned: false }), // v1→v2: notes gained a "pinned" flag
        2: (p) => {
          const { body, ...rest } = p as { body?: unknown }; // v2→v3: "body" renamed to "text"
          return { ...rest, text: body ?? null };
        },
      },
    },
  };
  const oldEvent = { body: "written long ago" };
  console.log(`   stored (v1)  ${dim(j(oldEvent))}`);
  console.log(`   on read (v3) ${green(j(upcastToCurrent("Note", 1, oldEvent, registry)))}`);
  console.log(`\n   ${check} ${dim("the projection only ever sees the current shape.")}`);

  // ───────────────────────────────────────────────────────────────────────────
  header("⑦", "Tamper-proof: you cannot rewrite history — even with raw SQL");
  await tamperDemo();

  // ───────────────────────────────────────────────────────────────────────────
  console.log("");
  console.log(cyan("─".repeat(64)));
  console.log(bold("   What this is FOR:"));
  console.log(`   ${green("•")} ${bold("Memory")} — the agent never forgets; the log IS its memory.`);
  console.log(`   ${green("•")} ${bold("Trust")} — every decision is reconstructable and tamper-evident.`);
  console.log(`   ${green("•")} ${bold("Time-travel")} — replay the past to test, audit, and learn.`);
  console.log(dim("\n   One append-only log. Everything else is a consequence of it.\n"));
}

// ── the append-only database demonstration (needs Postgres) ──────────────────
async function tamperDemo(): Promise<void> {
  const url = process.env.MARROW_TEST_DATABASE_URL;
  if (!url) {
    console.log(
      dim(
        "   (skipped — no database. Re-run with MARROW_TEST_DATABASE_URL set to\n" +
          "    watch PostgreSQL itself refuse an UPDATE.)",
      ),
    );
    return;
  }
  const pool = new Pool({ connectionString: url });
  try {
    await pool.query(`DROP TABLE IF EXISTS ${MARK_EVENTS_TABLE} CASCADE`);
    await pool.query(`DROP TABLE IF EXISTS schema_migrations CASCADE`);
    await migrate(pool);
    const pg = new PostgresMark(pool);
    await pg.append("safe-1", { type: "ObjectCreated", id: "safe-1", objectType: "ledger" });
    console.log(`   recorded 1 event in real PostgreSQL.`);
    console.log(`   now an attacker tries:  ${yellow(`UPDATE ${MARK_EVENTS_TABLE} SET type = 'forged'`)}`);
    try {
      await pool.query(`UPDATE ${MARK_EVENTS_TABLE} SET type = 'forged'`);
      console.log(`   ${red("✗ the update succeeded — that should never happen!")}`);
    } catch (error) {
      console.log(`   ${check} ${bold("the database rejected it:")} ${dim(String((error as Error).message))}`);
    }
  } finally {
    await pool.end();
  }
}

// ── small view helpers ───────────────────────────────────────────────────────
function detail(event: MarkEvent): unknown {
  switch (event.type) {
    case "ObjectCreated":
      return { objectType: event.objectType };
    case "AttributeSet":
      return { [event.key]: event.value };
    case "StateChanged":
      return { state: event.state };
    case "NoteAdded":
      return { text: event.text };
  }
}

function summ(s: ObjectState | null): string {
  if (s === null) return j({});
  return j({ state: s.state, attributes: s.attributes, notes: s.notes.length, v: s.version });
}

function printChain(chain: readonly RecordedEvent[]): void {
  chain.forEach((r, i) => {
    const indent = "   " + "  ".repeat(i);
    const cause = r.causationId ? dim("  ⟵ caused by ↑") : dim("  (the case begins)");
    const label = `${r.event.type} ${dim(j(detail(r.event)))}`;
    console.log(`${indent}${green("●")} ${label}${cause}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
