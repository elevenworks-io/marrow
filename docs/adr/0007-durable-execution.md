# ADR-0007: Durable execution on the Mark (Layer 3a)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (the Mark is the durable-execution journal), ADR-0002 (organ boundary contract), ADR-0003 (event versioning)

## Context

The Cortex runs long, interruptible work — a case may take hours, spawn sub-tasks, call tools, and must survive restarts, retry idempotently, and resume exactly where it stopped (VISION §4 Cortex; ADR-0001). The question is *how*, without violating the invariants.

We surveyed the durable-execution landscape (2024–2026): Temporal, **DBOS Transact**, Restate, Inngest, AWS Step Functions, Azure Durable Functions. They all implement the *same* core mechanism — a memoization loop: record a step's result, let the process die, on restart replay completed steps by returning their recorded results (skipping their side effects) and continue. They differ only in **where the journal lives** and **what they cost in sovereignty/lock-in**. Step Functions and Azure Durable Functions are cloud-locked and therefore disqualified (§3.5). Temporal is the correctness gold standard but a heavy separate cluster whose event history is *a second journal*.

Durable execution is therefore not new infrastructure for us — it is a **pattern we already own**, because the Mark is already an append-only journal with replay (ADR-0001).

## Decision

**Build an explicit-checkpoint durable-execution journal directly on the Mark.**

- **Steps as events:** `StepStarted` → `StepCompleted{ output }` (or `StepFailed{ error }`). Resume = fold an object's events to find steps started without a terminal event; every `StepCompleted` is **memoized** — return its recorded `output`, never re-execute.
- **Every non-deterministic operation behind a recorded step.** LLM calls, tool/HTTP calls, `now()`, random — executed once, the result written as an event; on resume the recorded value is returned. The LLM is treated as a **pure function `(context) → proposal`**; the context is rebuilt by replaying the Mark, the proposal becomes events. This keeps non-determinism out of the replay path entirely (explicit-checkpoint, *not* code-replay — so we avoid Temporal's "workflow code must stay deterministic forever" constraint).
- **Idempotent append:** every command/step carries an idempotency key; append via `INSERT … ON CONFLICT (dedupe_key) DO NOTHING` against a `UNIQUE` index (preferred over catching unique-violations, which bloats the heap and burns transaction ids). Retries become no-ops.
- **Side effects via a transactional outbox.** When a step must act externally (send an email, book), append the *intent* event **and** an `outbox` row in the **same** Postgres transaction — never dual-write. A relay (poll with `FOR UPDATE SKIP LOCKED`, later CDC) delivers at-least-once; an idempotent consumer (per-key sent-marker) makes the effect **effectively-once**. This is the Hands' safety.
- **Durable timers** the minimal Postgres way: a `due_at` table, workers claim due rows with `SELECT … FOR UPDATE SKIP LOCKED`, fire one wake event and flip state in one transaction; `UNIQUE(owner, scheduled_for)` makes scheduling idempotent.
- **Multi-step external actions = sagas on the Mark:** orchestration state, each step's outcome, and compensating actions are all events — durability, replay, and the glass-box audit come for free.
- **Adopt an engine only at a specific trigger:** when we would otherwise be rebuilding a workflow *control plane* on top of the Mark (large concurrent fleets, child-workflow orchestration, signals, cron fleets, operational search/terminate/retry). At that point adopt **DBOS Transact** (MIT, stores its journal as rows in *our own* Postgres — no second source of truth, no new infra, EU/on-prem, first-class TS), **not** Temporal. Reach for Temporal only if we outgrow single-Postgres scale, accepting its second-journal cost by confining its history to ephemeral runtime state while the Mark stays the record. This refines ADR-0002's organ-boundary contract.

## Consequences

**Positive**

- Durable, resumable, idempotent, and **auditable by construction** — the saga and every compensation are reconstructable from the Mark (§3.2). No new infrastructure.
- Sovereign and boring: it is plain events + plain Postgres, the same primitives ADR-0002 chose.

**Negative / costs we accept**

- We build the memoization loop, timers, and outbox ourselves (each small and well-trodden, but real).
- Exactly-once *delivery* is impossible (Two Generals); our honest target is at-least-once + idempotency = **effectively-once**, which requires discipline at every side effect.

## Alternatives considered

- **Adopt Temporal/an engine now.** Rejected — a second journal to reconcile (invariant risk), heavy ops, a determinism constraint that fights the agent's nature, and (for managed engines) cloud lock-in.
- **Let a framework's checkpointer (e.g. LangGraph) be the journal.** Rejected unless it is backed by the Mark or kept ephemeral — otherwise it is a second source of truth, exactly what ADR-0002's organ-boundary contract forbids.

## Notes

Realizes **Layer 3a** of the capability map. Sources: Inngest *How durable workflow engines work*; DBOS Transact (MIT) system tables / "why Postgres"; Temporal docs; microservices.io outbox / idempotent-consumer / saga; Postgres `SKIP LOCKED`; AWS "duplicate key violations" guidance.
