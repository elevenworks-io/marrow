# ADR-0004: Projections — async-first, with strongly-consistent per-object reads

- **Status:** Accepted
- **Date:** 2026-06-14
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (state is derived), ADR-0003 (events evolve by upcasting)

## Context

The kernel folds a single object's events in memory (`load`). The Mark needs much more: many **named, persisted, queryable, rebuildable** read models — lists ("all open tickets"), search, the schema projection (ADR-0005), and later memory. The design fork is how those read models are updated relative to writes:

- **Synchronous** — update the read model inside the append transaction. Immediate consistency, but the write path is coupled to read-store availability and it does not scale; every read model sits in the hot write path.
- **Asynchronous** — a runner tails the global event order and updates read models outside the append. Scales and decouples, but introduces eventual consistency: a read model can lag the log.

For an **autonomous-agent** product this matters more than for a human dashboard: an agent reads state, decides, and acts in milliseconds, so stale reads can cause real failures (race conditions on reservations, "context drift"). But two facts de-risk the choice for us:

1. Our **write path already guarantees correctness independently of projections.** `append` validates the new event against the object's current state (folded from its own events) and enforces optimistic concurrency via `expectedVersion` and `UNIQUE(object_id, seq)`. Two agents cannot both "reserve the same unit" regardless of how stale any projection is — the conflict is caught at append.
2. The expensive thing to change later is **not** the projection plumbing — it is **consumers' consistency assumptions.** Retrofitting "this list may be 200 ms stale" into code (and a UI, and agent steps) that assumed instant consistency is the costly, sprawling change.

## Decision

**Build projections async-first; keep authoritative per-object reads strongly consistent by folding from events.**

- **A projection is a pure `(state, event) => state` fold plus a persisted checkpoint position** on the global sequence. It is rebuildable from zero at any time — this rebuildability is exactly what makes schema-morph (ADR-0005) possible.
- **Async by default.** A runner tails the global event order and updates read models *outside* the append transaction. Read models are eventually-consistent **caches, never truth** (ADR-0001).
- **Per-object authoritative reads stay strongly consistent.** The agent's act loop reads an object by folding *its own* events (`load`), bypassing projections entirely. Write correctness is guaranteed at append, independent of projection lag.
- **Read-your-writes when needed.** `append` returns the event's `global_seq`; a reader that must observe its own write in a query projection can wait for that projection's position to reach `≥ global_seq`.
- **Consumers are consistency-aware from day one** — the Skin shows pending states, agent query steps use read-your-writes tokens where they must. We pay this design cost now, while it is cheap, rather than retrofit it later.

## Consequences

**Positive**

- Scales, and decouples the write path from read-store availability.
- Rebuildable, checkpointed read models are the **enabler for schema-morph** (ADR-0005) and for memory (Layer 3b).
- Consumers are designed for staleness from the start — no costly later retrofit.
- Agent correctness is never compromised: the act loop does not depend on projection freshness.

**Negative / costs we accept**

- Eventual consistency is a **permanent, bounded** property of the cross-object query side.
- Runner infrastructure to build and operate: checkpoints, ordered delivery, retries, rebuild.
- Consumers must be written for staleness (pending UI, read-your-writes) deliberately.

## Alternatives considered

- **Synchronous in-transaction projections as the default.** Rejected as the default — couples writes to the read store, does not scale, and (the decisive point) defers the expensive consumer-consistency work to a later, more painful retrofit. Synchronous updates may still be offered for a *specific* critical read model where it is worth the coupling.
- **"Sync now, async when load forces it."** Rejected (this revises an earlier inclination): the migration cost is the consumers' assumptions, not the plumbing, so deferring async makes the eventual change harder, not easier.
- **No projections / fold-everywhere.** Rejected: per-object folds cannot answer cross-object queries or search.

## Notes

Realizes **Layer 2** of the Mark capability map (projection framework + query side). The minimal first read model (`list_objects` by type) is pulled into existence by the vertical slice (ADR-0006), not built speculatively.
