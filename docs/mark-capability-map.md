# The Mark — capability map

> A living **roadmap artifact**, not a spec and not the vision. [`VISION.md`](../VISION.md)
> is the *why* and the permanent target; this file tracks *what the Mark still
> needs to become* and *how those capabilities stack*. It changes as we build.
> Decisions that get made along the way are recorded as ADRs in
> [`docs/adr/`](adr/), one per layer.

## The framing that matters

What exists today is the **Spine kernel**, not "the Mark." The kernel is
deliberately the smallest correct core (CLAUDE.md, *Current state*): a typed
immutable event, an append-only log keyed by object id with a monotonic
sequence, **one** projection, and `replay`. That is **layer 0** — the
foundation stone, not the building.

The Mark that `VISION.md §4` describes is a large subsystem. `VISION.md` is
explicit that the Mark is *simultaneously* five things conventional software
keeps in five separate systems: the durable-execution journal, the agent's
memory, the audit trail, the simulation substrate (the Time Machine), and the
learning signal. None of that exists yet. This map is the honest distance
between layer 0 and that target.

## What the Mark must be — capabilities vs. status

Only capabilities **inside the Mark** (the substrate) are listed. The organs
that *use* the Mark — the Senses, the Cortex, the Hands, the MCP fabric — are
out of scope here; they sit on top of these capabilities.

| Capability | What VISION requires | Status | Gap |
|---|---|---|---|
| **Event log & model** | append-only log; rich event taxonomy; **correlation/causation ids** so events form a decision chain; idempotency keys; event **versioning + upcasting** for immutable, long-lived events | partial | chains, idempotency, versioning — missing |
| **Projections** | a *framework*: many named projections, persisted and queryable, rebuildable, incrementally updated, with subscriptions (e.g. `LISTEN/NOTIFY`); **schema-driven** projections (Schema-morph) | partial | one hardcoded in-memory fold only; query side, multiple/persisted projections, schema-morph — missing |
| **Durable-execution journal** | agent runs recorded as events (step started/completed); idempotent resume after restart; checkpoints/positions; timers and retries | none | the whole role — missing |
| **Memory** | episodic timeline per object **plus** semantic retrieval (embeddings/vector) over events and objects so the Cortex can pull relevant precedent; "learns over night" = nightly jobs derive memory and write it back | none | the whole role — missing |
| **Audit reconstruction** | reconstruct *why*: the context seen, the reasoning, the confidence, the tools called, queried **as-of** the decision moment | partial | glass-box metadata field exists but nothing populates or reconstructs it; as-of query — missing |
| **Time Machine / simulation** | replay **to a point in time**; **branch/fork** the timeline into a sandbox; run new agent behaviour against real history; diff outcomes | partial | replay folds a whole sequence; as-of replay and branching — missing |
| **Confidence-gated autonomy** | decision events carrying confidence; thresholds expressed as events; escalation events; human corrections that flow back into memory | none | the whole role — missing |
| **Integrity & sovereignty** | tamper-evidence (hash-chained events); retention; tenant/on-prem boundaries; encryption at rest | partial | DB triggers enforce append-only; hash-chain, retention, tenancy — missing |

## How the capabilities stack

Nothing above is parallel work — it stacks. Each layer folds onto the ones
below it.

```
Layer 0  Event + append-only log + replay + one projection         ✅ HAVE (kernel)
Layer 1  Envelope enrichment: correlation/causation ids,
         idempotency keys, event versioning / upcasting             ← everything above depends on this
Layer 2  Projection framework (many, persisted, rebuildable,
         subscriptions) + query side + Schema-morph                 ← the Skin & "one substrate" depend here
Layer 3a Durable-execution journal      (needs idempotency/L1 + projections/L2)
Layer 3b Memory & retrieval             (needs projections/L2 + write-back jobs)
Layer 4  Time Machine (as-of + branch)  ┐ (need global order + projections
         Audit reconstruction           ┘  + correlation ids from L1)
Cross-cutting  Confidence/autonomy event types · hash-chain integrity · sovereignty
```

Only on top of these do the **organs** live (Senses, Cortex, Hands, MCP fabric).
They are not the Mark; they consume it.

## Why this order

- **Layer 1 first** because literally everything above hangs on it: glass-box
  needs decision *chains* (correlation/causation), durable execution needs
  *idempotency*, and the Time Machine needs old events to stay readable forever
  (*versioning/upcasting*). Enriching the envelope after organs depend on it is
  far more expensive than doing it now, while the event taxonomy is tiny.
- **Layer 2 before 3/4** because the durable journal, memory, audit, and the
  Time Machine all read through projections and the query side, not by folding
  one object at a time.
- **3a and 3b are siblings**, both resting on L1+L2; they can proceed in either
  order or together.
- **Cross-cutting concerns** (autonomy event types, integrity, sovereignty) are
  introduced where they first bite, not bolted on at the end.

## Working agreement

- Each layer is proposed and recorded as its own **ADR** (`docs/adr/`),
  numbered in order (Layer 1 → ADR-0003, and so on), with the same honest
  options/trade-offs/decision format as ADR-0001/0002.
- Each layer is built in **small, verifiable steps**, test-first, exactly like
  the kernel — `event → projection → replay` is the pattern every layer extends,
  never replaces.
- This map is updated as layers land, so "what the Mark still needs" is always
  visible rather than living in someone's head.

## Known deferrals (layer 0)

These are **conscious decisions**, not undiscovered bugs. They are correct to
defer at the kernel stage; recorded here so they surface on purpose when their
layer arrives, not as a late surprise.

- **Snapshots.** `load` and `append` fold an object's whole history every time
  (append re-folds to compute the next version); `read`/`readCorrelation` are
  unbounded. At ~10k events per object this is the classic event-sourcing cliff.
  ADR-0001 anticipates snapshots as a *cache* derived from events; introduce them
  when the pain is real, never before — and never as a second source of truth.
  **Expect this earlier than "Layer 2/3":** the ADR-0006 vertical slice is where
  a dogfooding agent first produces a *long* object. Set a `statement_timeout`
  on the Pool from the slice onward.
- **Numbered migrations.** A single idempotent `migrate()` is enough today. An
  evolving schema needs ordered, versioned migrations — lands with Layer 1
  (event versioning) or the first schema change, whichever comes first.
- **Postgres in CI.** `describe.skipIf(!url)` means that without
  `MARROW_TEST_DATABASE_URL` the most intricate path (`PostgresMark`) does not
  run. CI must provide a Postgres service container, or the riskiest layer goes
  untested there. To wire up with the first CI pipeline.

## Decisions taken (ADRs)

The direction for the layers above is now recorded. Implementation follows the
sequence.

> **Provisional from Layer 3 on.** ADR-0007–0011 are marked *Accepted
> (provisional)*: locked as direction, but no organ has yet put them under
> pressure. The first organ — the ADR-0006 vertical slice — is the reality
> check, and it is expected to correct some of these. We hold the theory loosely
> until the slice tests it; ADR-0001–0006 are firm.

| Layer / concern | ADR | Decision in one line |
|---|---|---|
| L1 — event versioning | [ADR-0003](adr/0003-event-versioning.md) | Immutable events; evolve by upcasting on read, strict-on-write / version-scoped-on-read |
| L2 — projections | [ADR-0004](adr/0004-projections-async-first.md) | Async-first projections; per-object authoritative reads stay strongly consistent |
| Schema-morph | [ADR-0005](adr/0005-schema-morph.md) | Schema as events; object types as projections; borrow Zammad's wisdom, invert its DDL mechanism |
| Vertical slice | [ADR-0006](adr/0006-first-organ-mcp-vertical-slice.md) | First organ = expose the Mark over MCP; dogfood; pulls minimal L2 |
| L3a — durable execution | [ADR-0007](adr/0007-durable-execution.md) | Explicit-checkpoint journal on the Mark; outbox + SKIP LOCKED timers; DBOS only at the control-plane trigger, never Temporal early |
| L3b — memory | [ADR-0008](adr/0008-memory-as-projection.md) | Mark = episodic memory; semantic retrieval as a rebuildable pgvector projection; nightly consolidation appends derived events, never truth |
| L4 — Time Machine & audit | [ADR-0009](adr/0009-time-machine-and-audit.md) | As-of replay (bitemporal) first; true branching deferred; audit falls out of correlation ids + metadata |
| Confidence-gated autonomy | [ADR-0010](adr/0010-confidence-gated-autonomy.md) | Action-tier floor + empirical confidence; "confidence ≠ permission"; decision chain as events incl. OutcomeObserved |
| Integrity & sovereignty | [ADR-0011](adr/0011-integrity-and-sovereignty.md) | Hash-chain + signed digest; crypto-shredding for GDPR erasure; model-agnostic EU/on-prem inference |

## Status

- **Layer 0 — done.** The Spine kernel: typed immutable events, append-only log,
  one projection, replay; in-memory + PostgreSQL adapters; `load == replay(read)`
  proven on both.
- **Layer 1 — done ([ADR-0003](adr/0003-event-versioning.md)).** Envelope
  enrichment: numbered migrations, event versioning + upcasting-on-read, causal
  lineage (eventId / correlation / causation + `readCorrelation`), per-object
  idempotency. Reviewed (code + security); the deferred items are tracked here.
- **Vertical slice — done ([ADR-0006](adr/0006-first-organ-mcp-vertical-slice.md)).**
  The first organ: the Mark exposed over MCP (7 tools), dogfoodable from an
  assistant; `listObjects` is the first cross-object read model.
- **Cortex slice — done.** The first organ *with intelligence* (the agent loop):
  perceive a complaint → decide (draft + confidence) → gate on action tier T3
  (ADR-0010) → record the decision chain (`DecisionProposed → ConfidenceAssessed
  → Acted | Escalated`) on the Mark. `ObjectState` stays field-clean; the
  decision trace is a **separate projection** (`replayDecision`, keyed by
  correlationId — 2B-lite, the second read model after `list_objects`). The
  model is a swappable `Decider` seam (fake-only here); "act" records a draft
  *intent* with no dispatcher. Puts the provisional ADRs 0007/0009/0010 under
  real, agent-produced pressure. Spec:
  `docs/superpowers/specs/2026-06-15-cortex-slice-design.md`.
- **Layer 2 / schema-morph — decided** (ADR-0004 / 0005), not yet built.
- **Layers 3a, 3b, 4 and cross-cutting — *provisional*** (ADR-0007–0011), held
  loosely pending what the slice and the Cortex reveal.

## Findings from dogfooding (the slice)

What real use teaches — the slice's whole purpose (ADR-0006).

- **Cross-call causal correlation is not threaded.** Driven over separate MCP
  tool calls, each call becomes its own lineage root (`causationId: null`, its
  own `correlationId`); only events within a single `create_object` share a
  correlation. For a *single* object this is fine — `get_history(id)` is the full
  story. The gap is **cross-object "cases"** (e.g. a complaint that spawns a
  refund object *and* a task). Deliberately **not** fixed yet: (a) it blocks
  nothing today — no workflow yet creates such cases; (b) "case" is a substrate /
  Cortex modelling decision (ADR-0009), not an organ patch; (c) rich causal
  chains are meaningful when MARROW's *own* agent (the Cortex) acts
  (perception → decision → action) — an external assistant poking raw tools has
  no internal "why" to thread, so each call genuinely *is* an independent action.
  **Open question for the Cortex:** how should a case correlate actions across
  tools/objects — an explicit `caseId`, a session-scoped "current case", or
  `causedBy` threading? Decide with several real workflow data points, not this
  one.

## Findings from the Cortex slice

What the first acting agent teaches (fill from real runs — the slice's purpose):

- **Within-object decision episodes thread cleanly.** A Cortex run's chain shares
  one `correlationId`; unlike the MCP slice (each call its own root), the agent's
  own action has a real "why" to thread. Cross-object cases remain open (decide
  with more workflow data points, per the MCP-slice finding).
- **Durable-by-default bit early.** A partial run (crash after `DecisionProposed`)
  must *resume*, not stall — the idempotent short-circuit had to be narrowed to
  terminal episodes, and resume recovers the recorded proposal rather than
  re-rolling the model. The thin slice already exercised ADR-0007's record-the-result.
- _(to record after more use:)_ Is the `Decider` seam the right shape when a real
  model adapter lands? Is recorded `confidence` (placeholder) enough envelope for
  audit? Does the version-only pass-through (decision events bump
  `ObjectState.version`) confuse consumers, or is it honest? When does 2B-lite →
  full 2B pull (the calibration-curve query)?
