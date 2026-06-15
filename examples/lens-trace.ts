// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 — see the agent's decision chain reconstructed from the Mark, with no
 * API key (a scripted decider stands in for the model):
 *
 *   npm run lens            # rendered trace
 *   npm run lens -- --json  # the structured TraceForest
 *
 * Nothing here reaches the outside world. The trace IS the events — no second
 * source of truth.
 */

import { InMemoryMark } from "../src/mark/index.js";
import { Cortex, FakeDecider } from "../src/organs/cortex/index.js";
import { replayTrace, summarizeEpisodes, renderTrace } from "../src/organs/lens/index.js";

async function seed(mark: InMemoryMark, id: string, text: string): Promise<void> {
  const created = await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "channel:email" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "channel:email" }, causedBy: created });
}

async function main(): Promise<void> {
  const mark = new InMemoryMark();
  await seed(mark, "complaint-acted", "My order never arrived and I want a status update.");
  await seed(mark, "complaint-escalated", "This is the third time and I'm considering legal action.");

  await new Cortex(mark, new FakeDecider({ draft: "We're sorry — your order ships tomorrow with tracking.", confidence: 0.92 }), { threshold: 0.8, actor: "cortex" }).run("complaint-acted");
  await new Cortex(mark, new FakeDecider({ draft: "We understand your frustration and are escalating.", confidence: 0.45 }), { threshold: 0.8, actor: "cortex" }).run("complaint-escalated");

  const json = process.argv.includes("--json");
  for (const id of ["complaint-acted", "complaint-escalated"]) {
    const events = await mark.read(id);
    console.log(`\n=== ${id} ===`);
    if (json) {
      console.log(JSON.stringify(replayTrace(events), null, 2));
    } else {
      console.log(renderTrace(replayTrace(events), summarizeEpisodes(events)));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
