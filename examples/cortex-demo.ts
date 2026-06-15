// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * A guided, visual tour of the Cortex — MARROW's agent loop (VISION §4).
 * Run it and watch the agent perceive, decide, gate, and record *why*, step by
 * step, on real data — with no API key (a scripted decider stands in for the
 * model):
 *
 *   npm run cortex:demo
 *
 * Nothing here reaches the outside world: "acting" records a draft *intent*; the
 * value is the glass-box trail it leaves behind, all of it folded from events.
 */

import {
  InMemoryMark,
  type MarkEvent,
  type RecordedEvent,
} from "../src/mark/index.js";
import {
  Cortex,
  FakeDecider,
  gate,
  readObjectWithDecision,
} from "../src/organs/cortex/index.js";

// ── tiny terminal styling (degrades to plain text if NO_COLOR is set) ─────────
const useColor = !process.env.NO_COLOR;
const sgr = (code: string) => (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const cyan = sgr("36");
const green = sgr("32");
const yellow = sgr("33");
const red = sgr("31");
const magenta = sgr("35");
const check = green("✓");

function header(n: string, title: string): void {
  console.log("");
  console.log(cyan(bold(`${n}  ${title}`)));
  console.log(cyan("─".repeat(64)));
}

function banner(): void {
  const line = "═".repeat(64);
  console.log(cyan(`╔${line}╗`));
  console.log(cyan("║ ") + bold("THE CORTEX — the agent loop, glass-box") + cyan(" ".repeat(24) + "║"));
  console.log(
    cyan("║ ") + dim("Perceive → decide → gate → act. Every 'why' is recorded.") + cyan("  ║"),
  );
  console.log(cyan(`╚${line}╝`));
}

const j = (v: unknown) => JSON.stringify(v);
const clip = (s: string, n = 46) => (s.length > n ? `${s.slice(0, n)}…` : s);

async function seedComplaint(mark: InMemoryMark, id: string, text: string): Promise<void> {
  await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "channel:email" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "channel:email" } });
}

async function main(): Promise<void> {
  banner();

  // ───────────────────────────────────────────────────────────────────────────
  header("①", "A complaint arrives — as an object the agent will perceive");
  console.log(dim("   No special intake. It's just an object in the Mark; the agent reads it.\n"));

  const mark = new InMemoryMark();
  const confident = "complaint-101";
  await seedComplaint(mark, confident, "My order never arrived and I want a status update.");
  console.log(`   ${green("▸")} complaint ${bold(confident)}`);
  console.log(`     ${dim("text:")} "${clip("My order never arrived and I want a status update.")}"`);

  // ───────────────────────────────────────────────────────────────────────────
  header("②", "The agent runs its loop — and decides");
  console.log(dim("   The model (here scripted) proposes a reply + a self-assessed confidence.\n"));

  const decider = new FakeDecider({
    draft: "We're sorry for the delay — your order ships tomorrow with tracking.",
    confidence: 0.92,
  });
  const episode = await new Cortex(mark, decider, { threshold: 0.8, actor: "cortex:demo" }).run(confident);

  console.log(`   ${dim("perceive")}  read the complaint   ${dim("→ context for the model")}`);
  console.log(`   ${dim("decide")}    propose a draft      ${dim("→")} "${clip("We're sorry for the delay — your order ships tomorrow…")}"`);
  console.log(`   ${dim("assess")}    confidence ${bold("0.92")}      ${dim("→ vs threshold 0.80, action tier")} ${bold("T3")} ${dim("(external)")}`);
  console.log(`   ${dim("gate")}      0.92 ≥ 0.80 on T3    ${dim("→")} ${green(bold("ACT"))}`);
  console.log(`\n   ${check} episode status: ${green(bold(episode.status))}`);

  // ───────────────────────────────────────────────────────────────────────────
  header("③", "The whole decision, recorded on the Mark — the glass-box 'why'");
  console.log(dim("   One run, one correlation id; each step caused by the one before it:\n"));
  printDecisionChain(await mark.read(confident));
  console.log(`\n   ${check} ${dim("get_history reconstructs exactly why the agent acted — from events alone.")}`);

  // ───────────────────────────────────────────────────────────────────────────
  header("④", "'Act' recorded an INTENT — nothing was ever sent");
  const history = await mark.read(confident);
  const proposed = history.find((e) => e.event.type === "DecisionProposed");
  const acted = history.find((e) => e.event.type === "Acted");
  const draftRef = acted?.event.type === "Acted" ? acted.event.draftRef : "";
  console.log(`   Acted.draftRef ${dim(draftRef.slice(0, 8))} ${dim("→ points at")} DecisionProposed ${dim((proposed?.eventId ?? "").slice(0, 8))}`);
  console.log(
    `\n   ${check} the draft is a recorded intent. ${bold("No dispatcher exists")} — ` +
      dim("zero outward effect, full audit value."),
  );

  // ───────────────────────────────────────────────────────────────────────────
  header("⑤", "A murkier complaint → the agent escalates instead");
  const murky = "complaint-102";
  await seedComplaint(mark, murky, "This is the third time and I'm considering legal action.");
  const murkyEpisode = await new Cortex(
    mark,
    new FakeDecider({ draft: "We understand your frustration…", confidence: 0.45 }),
    { threshold: 0.8, actor: "cortex:demo" },
  ).run(murky);
  console.log(`   confidence ${bold("0.45")} < threshold 0.80 on T3 ${dim("→")} ${yellow(bold("ESCALATE"))}`);
  console.log(`   episode status: ${yellow(bold(murkyEpisode.status))}, draft released: ${bold(j(murkyEpisode.draft))}`);
  console.log(`\n   ${check} ${dim("below the line, the agent hands off to a human — nothing is auto-sent.")}`);

  // ───────────────────────────────────────────────────────────────────────────
  header("⑥", "Confidence ≠ permission — the tier is a floor");
  console.log(dim("   A high-confidence high-risk action is still escalated. The gate proves it:\n"));
  console.log(`   gate(${bold("T3")}, 0.92, 0.80) ${dim("→")} ${green(gate("T3", 0.92, 0.8))}      ${dim("draft a reply (external)")}`);
  console.log(`   gate(${bold("T4")}, ${red("0.99")}, 0.80) ${dim("→")} ${yellow(gate("T4", 0.99, 0.8))}  ${dim("e.g. issue a refund (irreversible) — human, always")}`);
  console.log(`\n   ${check} ${dim("0.99 confidence never buys past a T4 action. Autonomy is gated by risk first.")}`);

  // ───────────────────────────────────────────────────────────────────────────
  header("⑦", "Durable: a crashed run resumes — without re-asking the model");
  console.log(dim("   Simulate a crash right after the model proposed, before the chain finished:\n"));
  const crashMark = new InMemoryMark();
  const crashed = "complaint-103";
  await seedComplaint(crashMark, crashed, "Where is my refund?");
  // The model already ran and its proposal was recorded — then the process died.
  await crashMark.append(
    crashed,
    { type: "DecisionProposed", draft: "Your refund is being processed and arrives in 3–5 days.", perceivedObjectId: crashed, perceivedSeq: 2 },
    { metadata: { actor: "cortex:demo", confidence: 0.9 }, idempotencyKey: `decision:proposed:${crashed}` },
  );
  console.log(`   ${red("✗ crash")}  ${dim("after DecisionProposed (draft recorded, chain incomplete)")}`);

  // Resume with a decider that would return a DIFFERENT answer if it were called.
  const wouldReRoll = new FakeDecider({ draft: "THIS SHOULD NEVER APPEAR", confidence: 0.1 });
  const resumed = await new Cortex(crashMark, wouldReRoll, { threshold: 0.8, actor: "cortex:demo" }).run(crashed);
  console.log(`   ${green("↻ resume")} ${dim("→ status")} ${green(bold(resumed.status))}, model calls on resume: ${bold(String(wouldReRoll.calls))}`);
  console.log(`     draft kept: "${clip(resumed.draft ?? "")}"`);
  console.log(
    `\n   ${wouldReRoll.calls === 0 ? check : red("✗")} ${bold("the recorded proposal is the truth")} ` +
      dim("— resume completes the chain, the model is never re-rolled."),
  );

  // ───────────────────────────────────────────────────────────────────────────
  header("⑧", "Two reads, cleanly separated — and merged on demand");
  console.log(dim("   ObjectState is the domain fold; the decision trace is its OWN projection.\n"));
  const merged = await readObjectWithDecision(mark, confident);
  console.log(`   load(id)              ${dim("→ field-clean object:")} ${j({ objectType: merged?.state.objectType, attributes: merged?.state.attributes, version: merged?.state.version })}`);
  console.log(`     ${dim("has a 'decision' field?")} ${bold(j(merged?.state ? "decision" in merged.state : false))}`);
  console.log(`   replayDecision(read)  ${dim("→ the separate trace:")} ${magenta(j({ status: merged?.decision?.status, confidence: merged?.decision?.confidence }))}`);
  console.log(
    `\n   ${check} ${dim("the agent's 'why' never pollutes the object — it's a named projection (ADR-0004).")}`,
  );

  // ───────────────────────────────────────────────────────────────────────────
  console.log("");
  console.log(cyan("─".repeat(64)));
  console.log(bold("   What this is FOR:"));
  console.log(`   ${green("•")} ${bold("Glass-box")} — every autonomous decision is reconstructable: what it saw, proposed, how sure, what it did.`);
  console.log(`   ${green("•")} ${bold("Gated autonomy")} — it acts above the line, escalates below; risk tier is a hard floor.`);
  console.log(`   ${green("•")} ${bold("Durable")} — a half-finished decision resumes; the model is asked once, recorded forever.`);
  console.log(`   ${green("•")} ${bold("Model-agnostic")} — the Decider is a seam; any model plugs in, none is baked in.`);
  console.log(dim("\n   The agent acts — and never forgets, and never hides why.\n"));
}

// ── view helpers ─────────────────────────────────────────────────────────────
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
    case "DecisionProposed":
      return { draft: clip(event.draft, 38), perceivedSeq: event.perceivedSeq };
    case "ConfidenceAssessed":
      return { confidence: event.confidence, threshold: event.threshold, tier: event.tier };
    case "Acted":
      return { draftRef: event.draftRef.slice(0, 8) };
    case "Escalated":
      return { reason: clip(event.reason, 38) };
    case "OutcomeObserved":
      return { wasCorrect: event.wasCorrect };
  }
}

/** Print the recorded decision chain — the events the agent itself wrote. */
function printDecisionChain(events: readonly RecordedEvent[]): void {
  const chainTypes = ["DecisionProposed", "ConfidenceAssessed", "Acted", "Escalated", "OutcomeObserved"];
  const chain = events.filter((e) => chainTypes.includes(e.event.type));
  chain.forEach((r, i) => {
    const indent = "   " + "  ".repeat(i);
    const cause = r.causationId ? dim("⟵ caused by ↑") : dim("(the decision begins)");
    const conf = r.metadata.confidence !== undefined ? dim(` conf=${r.metadata.confidence}`) : "";
    console.log(`${indent}${green("●")} ${bold(r.event.type)} ${dim(j(detail(r.event)))} ${cause}${conf}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
