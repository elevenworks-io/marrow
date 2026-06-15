// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Cortex slice, made visible (ADR-0006 / VISION §4). Two complaints: one the
 * agent answers confidently (acts — a draft intent is recorded), one it is
 * unsure about (escalates — nothing released). Runs on an in-memory Mark with a
 * scripted decider: no API key, fully reproducible. The history printed at the
 * end is the glass-box "why" — the whole decision chain, recorded.
 */

import { InMemoryMark } from "../src/mark/index.js";
import { Cortex, FakeDecider, readObjectWithDecision } from "../src/organs/cortex/index.js";

async function seedComplaint(mark: InMemoryMark, text: string): Promise<string> {
  const id = `complaint-${text.length}-${text.charCodeAt(0)}`;
  await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "demo" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "demo" } });
  return id;
}

async function main(): Promise<void> {
  const mark = new InMemoryMark();

  // 1) A confident answer → the agent acts (records a draft intent).
  const confident = await seedComplaint(mark, "My order never arrived and I want a status update.");
  await new Cortex(mark, new FakeDecider({
    draft: "We're sorry for the delay — your order ships tomorrow with tracking.",
    confidence: 0.92,
  }), { actor: "cortex:demo" }).run(confident);

  // 2) A murkier complaint → low confidence → the agent escalates.
  const murky = await seedComplaint(mark, "This is the third time and I'm considering legal action.");
  await new Cortex(mark, new FakeDecider({
    draft: "We understand your frustration…",
    confidence: 0.45,
  }), { actor: "cortex:demo" }).run(murky);

  for (const id of [confident, murky]) {
    const merged = await readObjectWithDecision(mark, id);
    console.log(`\n=== ${id} ===`);
    console.log("decision:", merged?.decision);
    console.log("glass-box chain:");
    for (const e of await mark.read(id)) {
      console.log(`  #${e.seq} ${e.event.type}  (actor: ${e.metadata.actor}, corr: ${e.correlationId.slice(0, 8)})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
