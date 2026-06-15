# CLAUDE.md — Operating context for AI coding agents

You are working on **MARROW**. Before doing anything substantive, read [`VISION.md`](VISION.md) — it is the target. This file tells you how to behave while building toward it.

## Prime directive

The invariants in **VISION.md §3** are law. They outrank convenience, cleverness, and any default instinct. If a change would violate one of them, it is wrong — stop and reconsider, or open an ADR proposing to change the invariant itself (a high bar). Never silently work around them.

## The architecture in one paragraph

MARROW is built on **the Mark**: an append-only event log that is the single source of truth. Every perception, decision, action, and state change is an immutable event. The “current state” of any object is a **projection** folded from those events — never a mutable record with a log stapled on. This one structure simultaneously *is* the durable-execution journal, the agent’s memory, the audit trail, the simulation substrate, and the learning signal. Everything else — intake, the agent loop, actions, the MCP fabric, the surfaces — is an organ attached to this spine.

## Hard rules

- **Events are truth; state is derived.** Anything that reads as authoritative must be reconstructable by replaying events. If you find yourself mutating state as the primary write, you’ve taken a wrong turn.
- **Glass-box.** Every autonomous action must leave enough in the Mark to reconstruct *why* it happened — the context, the reasoning, the confidence, the tools called.
- **Autonomy is gated.** The agent acts above a confidence threshold and escalates below it. Thresholds are tunable per action type. There is no “just let it run unsupervised” path.
- **Durable by default.** Long-running agent work is checkpointed into the Mark so it survives restarts, retries idempotently, and resumes. Don’t build steps that can’t be safely replayed.
- **Sovereign.** Data and inference must be able to run in the EU or on-prem. No hard dependency on a single proprietary cloud or a single model vendor. Model-agnostic; route deliberately.
- **MCP both directions.** MARROW consumes external tools as MCP and exposes its own objects/actions as an MCP server. Don’t build closed, one-off integrations where a standard tool interface belongs.
- **One substrate, not ten apps.** New domains come from reconfiguring objects and workflows, not from forking the codebase or starting a parallel product.
- **Boring plumbing, bold behavior.** Reach for the most durable, unexciting primitive that works for infrastructure. Spend complexity on intelligence and trust, nowhere else. (An append-only table is the right amount of boring for the event store today; you don’t need a distributed log to start.)
- **Licensing** this must always be at the top of each source file: // SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

## Current state

The **Spine kernel** and **Layer 1** are built, and the **first organ** (the Mark over MCP) is live. The substrate is real, tested, and dogfoodable — not a sketch.

- **The Mark** — `src/mark/`. Typed immutable events; an append-only log keyed by object id with a monotonic sequence (in-memory **and** PostgreSQL adapters); **one** projection + `replay`. Plus Layer 1: numbered migrations, event versioning with upcasting-on-read (ADR-0003), causal lineage — eventId / correlation / causation + `readCorrelation` (ADR-0009), and per-object idempotency (ADR-0007). `load == replay(read)` is proven on both adapters.
- **The first organ** — `src/organs/mcp/`. The Mark exposed over MCP (7 tools), runnable via `npm run mcp`, drivable from any assistant (ADR-0006).
- **What's decided vs. still open** lives in [`docs/mark-capability-map.md`](docs/mark-capability-map.md). ADR-0001–0006 are firm; **ADR-0007–0011 (Layer 3+) are *provisional*** — held loosely until the organs put them under real pressure. The map also records findings from actual use.

Run the suite with `npm test` (Postgres via `npm run db:up`); watch the substrate prove itself with `npm run tour`. When deciding what to build next, start from the capability map — don't assume the next layer down; the highest-value next move is a judgement, not a default.

## How we work

This rhythm produced the foundation; hold to it — it is the standard, not a suggestion.

- **Decisions live in ADRs** under `docs/adr/`, numbered and dated, each in the same honest *context / decision / consequences / alternatives* form. ADR-0001 (event-sourced substrate) and ADR-0002 (stack: TypeScript on Node + PostgreSQL) are the founding decisions.
- **Test-driven, in small verifiable steps.** Write the failing test, watch it fail, make it pass — then harden. Prove `event → projection → replay` before building upward. Every new behaviour has a test.
- **Both adapters in parity.** The Mark has an in-memory adapter (fast tests) and a PostgreSQL adapter (the real store); they implement the same contract and are tested identically. `load == replay(read)` must hold on both.
- **Review, then harden.** After a meaningful chunk, run an independent code review *and* a security pass; fix findings **at the right layer**, not the convenient one. Record deliberate deferrals openly (the capability map's "Known deferrals"), never silently.
- **Honest scope; let reality correct the theory.** Lock direction early in ADRs, but mark forward-looking ones *provisional* and let the first organ / real use correct them. The vertical slice is a reality check — let it be one. Don't defend an elegant theory; don't drift scope to feel thorough.
- **Branch → PR → merge → clean.** Never pile work on `main`; one logical change per PR, delete the branch after merge, keep `main` in sync and green.
- **Reproducible and shown.** `npm run db:up`, `npm test`, `npm run tour`, `npm run mcp:demo` — the build proves itself on a fresh clone, and demos make it *visible*.
- **Commits** are conventional and scoped (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). Sign off per `CONTRIBUTING.md`.
- When in doubt about *what* something should do or feel like, the answer is in `VISION.md`. When in doubt about *how* we decide, it’s an ADR. When in doubt about *where we are*, it’s the capability map.

## Where things live

- `VISION.md` — the target (what / why / the feeling).
- `docs/adr/` — decisions over time (ADR-0001…0011).
- `docs/mark-capability-map.md` — the roadmap artifact: capabilities vs. status, the layer stack, known deferrals, and findings from real use. *Where we are.*
- `CLAUDE.md` — this file (how to behave here).
- `src/mark/` — the Spine (the Mark): `event`, `projection`, `log` (in-memory adapter), `postgres`, `migrations`, `upcasting`, `event-schema`.
- `src/organs/` — organs attached to the spine. `src/organs/mcp/` is the first one (the Mark over MCP).
- `examples/` — runnable demos (`mark-tour.ts`, `mcp-demo.ts`).

## Definitely don’t

- Don’t bolt an agent onto a mutable CRUD app and call it the Mark.
- Don’t fork a mutable-state monolith for the substrate. Learn from prior art’s domain wisdom; build the spine clean.
- Don’t ship unsupervised autonomy.
- Don’t wall MARROW off from the agent ecosystem.
- Don’t reach for exotic infrastructure to feel advanced.