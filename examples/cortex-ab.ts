// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The A/B harness, made visible: run one complaint through the Anthropic and
 * OpenAI deciders and print both drafts, their self-reported confidence, and
 * what the gate (tier T3) would decide for each — side by side.
 *
 *   cp .env.example .env   # then fill in the keys
 *   npm run cortex:ab      # loads .env automatically (dotenv)
 *
 * This one DOES call real models (that's the point). Without the keys below it
 * prints what to set and exits — it never makes an unconfigured call. The two
 * deciders sit behind the same `Decider` seam; adding a third provider would be
 * one more entry here and one more adapter file — nothing else changes.
 */

import "dotenv/config"; // load .env (gitignored) so keys/model come from there
import {
  AnthropicDecider,
  OpenAIDecider,
  compareDeciders,
  type DeciderEntry,
} from "../src/organs/cortex/index.js";

const useColor = !process.env.NO_COLOR;
const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const cyan = sgr("36");
const green = sgr("32");
const yellow = sgr("33");

const COMPLAINT = "My order #4471 never arrived and the tracking page has said 'label created' for nine days.";
const THRESHOLD = 0.8;

function missingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.ANTHROPIC_API_KEY) missing.push("ANTHROPIC_API_KEY");
  if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
  if (!process.env.MARROW_CORTEX_OPENAI_MODEL) missing.push("MARROW_CORTEX_OPENAI_MODEL (e.g. a small/mid model that supports structured outputs)");
  return missing;
}

async function main(): Promise<void> {
  console.log(cyan(bold("\nCortex A/B — the same complaint, two providers, one seam\n")));
  console.log(`${dim("complaint:")} "${COMPLAINT}"`);
  console.log(`${dim("threshold:")} ${THRESHOLD} ${dim("on action tier T3 (external reply)")}\n`);

  const missing = missingConfig();
  if (missing.length > 0) {
    console.log(yellow("Not configured for a live run. Set these and re-run:"));
    for (const m of missing) console.log(`  - ${m}`);
    console.log(
      dim(
        "\n(Optional: MARROW_CORTEX_ANTHROPIC_MODEL, default claude-haiku-4-5.)\n" +
          "No call was made. This demo only runs when the keys above are present.",
      ),
    );
    return;
  }

  const entries: DeciderEntry[] = [
    { name: `anthropic (${process.env.MARROW_CORTEX_ANTHROPIC_MODEL ?? "claude-haiku-4-5"})`, decider: new AnthropicDecider() },
    { name: `openai (${process.env.MARROW_CORTEX_OPENAI_MODEL})`, decider: new OpenAIDecider() },
  ];

  const rows = await compareDeciders({ objectId: "complaint-ab", seq: 1, text: COMPLAINT }, entries, THRESHOLD);

  for (const row of rows) {
    const verdict = row.gate === "act" ? green(bold("ACT")) : yellow(bold("ESCALATE"));
    console.log(cyan(bold(`── ${row.name}`)));
    console.log(`   confidence ${bold(String(row.proposal.confidence))}  ${dim("→ gate:")} ${verdict}`);
    console.log(`   ${dim("draft:")} ${row.proposal.draft}\n`);
  }
  console.log(dim("Same seam, same prompt, same gate — only the model differs.\n"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
