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

## Current state

**Foundational.** The first thing to build is the **Spine kernel**, nothing more:

1. A typed, immutable `Event`.
1. An append-only log keyed by object id with a monotonic sequence.
1. **One** projection that folds events into current object state.
1. A `replay` that reconstructs an object’s state purely from its events.

A handful of event types is enough to prove the kernel (e.g. `ObjectCreated`, `AttributeSet`, `StateChanged`, `NoteAdded`). The kernel is correct when you can create an object *only* through events and recompute its state by replaying them. Build the spine before any organ.

## How we work

- **Decisions live in ADRs** under `docs/adr/`, numbered and dated. Architectural choices get recorded, not buried in code. ADR-0001 (event-sourced substrate) is accepted and is the founding decision.
- **The stack itself is an open decision — ADR-0002.** Language, runtime, datastore, and core dependencies are *not* yet chosen. Propose them in ADR-0002 with reasoning before scaffolding heavily. Choose deliberately; don’t inherit defaults by accident.
- **Small, verifiable steps.** Especially for the kernel: prove the projection/replay with tests before building upward.
- **Commits** are conventional and scoped (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`). Sign off per `CONTRIBUTING.md`.
- When in doubt about *what* something should do or feel like, the answer is in `VISION.md`. When in doubt about *how* we decide, it’s an ADR.

## Where things live

- `VISION.md` — the target (what / why / the feeling).
- `docs/adr/` — decisions over time.
- `CLAUDE.md` — this file (how to behave here).
- Code structure is intended to mirror the organism (a clear home for the spine/Mark, and organs attached to it), but the concrete layout follows the stack decision in ADR-0002 — realize it cleanly there rather than guessing now.

## Definitely don’t

- Don’t bolt an agent onto a mutable CRUD app and call it the Mark.
- Don’t fork a mutable-state monolith for the substrate. Learn from prior art’s domain wisdom; build the spine clean.
- Don’t ship unsupervised autonomy.
- Don’t wall MARROW off from the agent ecosystem.
- Don’t reach for exotic infrastructure to feel advanced.