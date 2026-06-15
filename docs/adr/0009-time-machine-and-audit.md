# ADR-0009: Time Machine and audit — as-of replay first, branching deferred (Layer 4)

- **Status:** Accepted (provisional — revisit after the ADR-0006 vertical slice)
- **Date:** 2026-06-15
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (replay), ADR-0003 (old events stay readable via upcasting), ADR-0004 (sandbox projection), ADR-0007 (the execution/replay boundary)

## Context

The Time Machine is a signature moment (VISION §5): before going live, the agent runs against the customer's **real** history (the last ten thousand cases) in a sandbox and shows exactly how it would have handled each, with a trace per decision — de-risking autonomy by "check it against your own past." Separately, **audit** must reconstruct *why* a decision was made: the context it saw, its reasoning, confidence, and tools, **as-of that moment** (§3.2).

Research: bitemporal databases (XTDB, Datomic) separate **valid time** (when something was true in the world) from **transaction time** (when the system recorded it), enabling as-of point-in-time queries on either axis; Datomic is "event sourcing without the hassle" and offers speculative `db.with` for what-if. Event sourcing naturally supports counterfactual analysis by replaying from a chosen point, or with modified inputs, into an alternative projection.

## Decision

**Deliver as-of replay first; defer true counterfactual branching; get audit almost free from the envelope.**

- **We are already bitemporal-capable** — events carry `occurredAt` (valid time) and `recordedAt` / `global_seq` (transaction time). Lock this: as-of queries along *both* axes ("what was true at T" vs "what we had recorded by point N").
- **The cheap early win is as-of replay:** fold an object's (or the system's) events up to sequence N / time T into a **sandbox projection**. The "show how it would have handled the last 10k cases" demo is *as-of replay against a sandbox projection + the agent logic* — **not** true timeline branching. It is safe because of the **replay-reads / execution-fires boundary** (ADR-0007): in the sandbox, side-effect *intents* are recorded but the outbox's real dispatch is gated off, so nothing reaches the outside world.
- **Audit reconstruction falls out almost free** *if* Layer-1 correlation/causation ids and the rich glass-box metadata exist (ADR-0003 envelope): "explain this decision" = the decision event's recorded context (reasoning, confidence, tools) plus an as-of query at its moment. There is **no separate audit subsystem** — it is a read over the Mark.
- **Defer true counterfactual branching** (fork a timeline and run *alternative decisions* forward). When it is warranted, use **virtual, run-scoped branches** (a base stream + an overlay from the fork point, in the spirit of Datomic `db.with`), never physical copies of history.
- **Snapshots accelerate as-of reconstruction** — droppable caches, version-tagged per ADR-0003.

## Consequences

**Positive**

- The jaw-drop demo is achievable **early and cheaply** (as-of replay + sandbox), well before the hardest feature.
- Audit is nearly free and is *reconstruction of why*, not a side log.
- Bitemporality handles lag, backdating, and corrections honestly (a correction is a later event, not a rewrite).

**Negative / costs we accept**

- Full counterfactual branching is real work, deliberately deferred.
- As-of reconstruction at scale needs snapshots.
- Replay must be deterministic *enough*; LLM non-determinism is handled by ADR-0007's record-the-result rule (the past decision is read, not re-rolled).

## Alternatives considered

- **A bolt-on audit log.** Rejected — it cannot reconstruct *why* and is not derivable from truth (§3.1/§3.2).
- **Physical copies of history for branching.** Rejected — heavy and append-only-unfriendly; virtual overlays are the right model when branching is needed.
- **Skip bitemporality (single time axis).** Rejected — then corrections and backdating cannot be represented honestly.

## Notes

Realizes **Layer 4**. Sources: XTDB / Crux bitemporality docs; Datomic as-of / `db.with` ("event sourcing without the hassle"); event-sourcing replay/temporal-query writing (Fowler, event-driven.io); EDPB Guidelines 02/2025 (immutable ledgers).
