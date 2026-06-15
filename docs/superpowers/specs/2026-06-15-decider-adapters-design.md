# Decider Adapters (Anthropic + OpenAI) + A/B harness — Design

- **Date:** 2026-06-15
- **Status:** Approved for build (brainstorming complete; owner away — proceeding autonomously per "leg los")
- **Owner:** elevenworks / MARROW
- **Builds on:** the Cortex slice (`2026-06-15-cortex-slice-design.md`). VISION §3.5 (model-agnostic / sovereign), §4 (the Cortex). ADR-0007 (record-the-result), ADR-0010 (gate), ADR-0011 (model-agnostic router — *not* built here; deferred).

## 1. Why

The Cortex slice shipped the `Decider` seam **fake-only**. This makes it real: two concrete adapters — Anthropic and OpenAI — behind the *same* `Decider` interface, plus a light A/B harness that runs one complaint through both and shows the two proposals side by side. It answers the slice's #1 open question ("is the seam the right shape under a real model?") and demonstrates the agnostic claim concretely: a second provider is a new file, zero changes to Cortex/gate/decision/events.

## 2. Locked scope (the thin cuts)

| Decision | Choice |
|---|---|
| **The seam is unchanged** | No change to `Decider`, `Cortex`, `gate`, `replayDecision`, or the event types. Adapters implement the existing `propose(context) → { draft, confidence }`. |
| **Agnosticism = a tiny interface, not a gateway** | There is **no** universal parameter-mapping layer. Each adapter hides its own params + structured-output mechanism internally. Adding a provider = implementing one method. |
| **A/B surface** | A standalone comparison harness (`compareDeciders`) + a `cortex:ab` demo — runs the same context through both deciders, prints both proposals and what the gate would decide for each. It does **not** run the full Cortex or write to the Mark (Q1 = A). |
| **Model tier** | Model is per-adapter config (env var + constructor option), defaulting to a **cheap tier** so the A/B runs cheaply (Q2 = A). Anthropic default `claude-haiku-4-5`; OpenAI default via `MARROW_CORTEX_OPENAI_MODEL` (a small/mid model that supports structured outputs — confirm the exact ID against OpenAI docs before a live run). |
| **Confidence** | Still the honest **placeholder** — the model self-reports it. Real calibration (self-consistency / semantic entropy) is a separate later step, explicitly **out of scope**. |
| **Sovereignty** | The seam keeps EU/on-prem a drop-in (a local vLLM/Ollama adapter is a future file). The first two concrete adapters are US clouds — bridged architecturally, deferred in practice. Stated, not accidental. |
| **No router** | ADR-0011's model-agnostic router (pick a model per task) is **not** built. The A/B harness is a comparison tool, not a router. |

## 3. Components

New files under `src/organs/cortex/deciders/`:

- **`proposal-schema.ts`** — the single shared zod schema `proposalSchema` = `{ draft: string, confidence: number }`, and `clampConfidence`/validation. Both adapters return a value validated against this; it is the one source of truth for the proposal shape.
- **`prompt.ts`** — `buildProposalPrompt(context) → { system, user }`. The shared context-engineering surface (thin: the complaint text → "draft a reply, rate your confidence 0–1"). Both adapters use it, so the *prompt* is held constant across the A/B (only the model differs).
- **`anthropic.ts`** — `AnthropicDecider implements Decider`. Uses `@anthropic-ai/sdk`. Constructor `{ client?, model?, apiKey? }`; default model `process.env.MARROW_CORTEX_ANTHROPIC_MODEL ?? "claude-haiku-4-5"`. `propose` calls `client.messages.parse({ model, max_tokens, output_config: { format: zodOutputFormat(proposalSchema) }, system, messages })` and returns the validated `{ draft, confidence }`. **The `client` is injectable** (a minimal structural interface) so tests stub it — no network in tests.
- **`openai.ts`** — `OpenAIDecider implements Decider`. Uses `openai`. Constructor `{ client?, model?, apiKey? }`; default model from `MARROW_CORTEX_OPENAI_MODEL`. `propose` calls the OpenAI structured-output parse (`responses`/`chat.completions.parse` with a zod response format) and returns the validated `{ draft, confidence }`. **`client` injectable** for tests. This file uses the OpenAI SDK only — the Anthropic claude-api guidance does not apply here.
- **`ab.ts`** — `compareDeciders(context, entries, threshold?) → Promise<ComparisonRow[]>` where `entries: { name: string; decider: Decider }[]` and each row is `{ name, proposal, gate }` (`gate` = the `gate("T3", confidence, threshold)` outcome). Pure orchestration over the seam + the existing `gate`. No Mark, no network of its own.

Modified:
- **`index.ts`** — export the adapters, the schema, `buildProposalPrompt`, and `compareDeciders` + `ComparisonRow`.
- **`package.json`** — add `@anthropic-ai/sdk` and `openai` deps; add `"cortex:ab": "tsx examples/cortex-ab.ts"`.
- **`examples/cortex-ab.ts`** — the runnable A/B. Builds both real adapters **env-gated**: if `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` (and the model env vars) are absent, it prints exactly what to set and exits 0 — it never makes an unconfigured call. With keys, it runs `compareDeciders` on a sample complaint and prints both drafts, confidences, and gate outcomes side by side.

**Dependency containment (the invariant):** `@anthropic-ai/sdk` and `openai` are imported **only** inside `anthropic.ts` / `openai.ts`. The Cortex core (`cortex.ts`, `gate.ts`, `decision.ts`, `read.ts`, the Mark) imports neither. That is what keeps the substrate model-agnostic (§3.5) — verified by a test (no core file imports a vendor SDK).

## 4. Testing (TDD, no network ever)

- **`proposal-schema`**: accepts `{draft, confidence}`; rejects missing/mistyped fields.
- **`prompt`**: `buildProposalPrompt` includes the complaint text; stable shape.
- **`AnthropicDecider`** with an **injected stub client** whose `messages.parse` returns a canned `{ parsed_output: {draft, confidence} }` → adapter returns the validated `Proposal`; a malformed stub response is rejected (zod), not silently passed.
- **`OpenAIDecider`** with an **injected stub client** returning the OpenAI parsed shape → same assertions.
- **`compareDeciders`** with two `FakeDecider`s (high + low confidence) → two rows with the right `proposal` and `gate` (`"act"` / `"escalate"`).
- **Containment test**: assert no file under `src/organs/cortex/` except `deciders/anthropic.ts` / `deciders/openai.ts` imports `@anthropic-ai/sdk` or `openai` (grep-style test or a simple source scan).
- **Build proves itself**: `npm test` + `npm run typecheck` green with **no API keys**. The live `cortex:ab` requires keys and is the owner's to run.

## 5. Out of scope (returns later when demanded)

A model-agnostic **router** (ADR-0011) · **confidence calibration** (self-consistency / semantic entropy) · a **local/EU adapter** (vLLM/Ollama — the seam already permits it) · wiring the real adapter **into `Cortex.run`** as a default (the Cortex still defaults to a fake; production wiring is a separate, deliberate step) · streaming · retries/backoff beyond what the SDKs do by default.

## 6. Invariant check

- **Model-agnostic / sovereign (§3.5).** ✅ Vendor SDKs are confined to their adapter files (containment test); the core never imports them; a local/EU model is a future drop-in behind the same seam.
- **Events are truth (§3.1).** ✅ Unchanged — adapters produce a `Proposal`; the Cortex records it as `DecisionProposed` (existing). The A/B harness writes nothing.
- **Glass-box (§3.2) / record-the-result (ADR-0007).** ✅ Unchanged — replay determinism still comes from the recorded `DecisionProposed`, independent of which real model produced it.
- **Honest scope.** ✅ Confidence is a flagged placeholder; sovereignty is bridged-not-delivered; the router is explicitly deferred.
