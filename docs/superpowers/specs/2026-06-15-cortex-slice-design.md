# Cortex-Slice — Design (thin vertical slice of the agent loop)

- **Date:** 2026-06-15
- **Status:** Approved for planning (brainstorming complete)
- **Owner:** elevenworks / MARROW
- **Relates to:** VISION §4 (the Cortex), §3.2 (glass-box), §3.3 (confidence-gated autonomy),
  §3.5 (model-agnostic). ADR-0001/0002 (substrate + stack), ADR-0004 (act-loop reads by folding),
  ADR-0007 (durable execution — record-the-result), ADR-0010 (confidence-gated autonomy).
- **Capability map:** this is the **second reality-check organ** (after the ADR-0006 MCP slice),
  putting top-down pressure on the *provisional* ADRs 0007/0009/0010 with real agent-produced data.

## 1. Why this, why now

The MCP slice (ADR-0006) proved the substrate from the outside, but its own dogfooding finding is
decisive: *"rich causal chains are meaningful when MARROW's own agent (the Cortex) acts —
an external assistant poking raw tools has no internal 'why' to thread."* The glass-box envelope
fields (`reason`, `confidence`, `tools`) exist but **nothing populates them**, and the entire
right-hand column of the capability map (decision chains, confidence gating, durable execution,
audit) is held *provisional* precisely because no agent has stressed it.

This slice is the first time MARROW's **own** agent perceives, decides, gates, and records *why* —
the same proven move as ADR-0006 (a thin vertical slice through an organ), one level up in ambition.
It is deliberately the **thinnest** agent loop that exercises the full decision chain + the gate.

## 2. Scope — locked decisions

The slice is anchored to one workflow: **complaint in → triage → draft a reply, gated.**

| # | Decision | Choice |
|---|---|---|
| 1 | **Perception boundary** | The complaint already exists as a `complaint` object in the Mark (created via existing `create_object` with a `text` attribute). The Cortex *perceives* it by reading it (`load`/`read`). **No intake / no Senses.** |
| 2 | **The one decision** | The `Decider` produces **one** proposal: a draft reply text + a self-assessed confidence (placeholder). The **Gate** routes it: above threshold → act; below → escalate. |
| 3 | **Event surface** | New events `DecisionProposed`, `ConfidenceAssessed`, `Acted`, `Escalated`, `OutcomeObserved`, on the complaint object, one `correlationId` per run. Three thin cuts: (a) **no** generic step journal — record-the-result lives in `DecisionProposed`; (b) **no** real outbox/relay — the intent is recorded, no dispatcher exists; (c) `OutcomeObserved` type included as the loop-closer, **no** calibration wired. |
| 4 | **LLM seam** | A narrow `Decider` interface; tests *and* the default demo run a deterministic `FakeDecider`. **No** real provider adapter in this slice (clean follow-up). Build proves itself on a fresh clone with no API key. |
| 5 | **Case / correlation** | Decision-chain events live **on the complaint object**, one fresh `correlationId` per Cortex run (the decision episode). Perception is a read (no event), so `DecisionProposed` records the perceived object id + the `seq` observed → as-of reconstruction of the "why". **Cross-object "case" stays deliberately open** (per the dogfooding finding: decide with several real workflow data points, not this one). |

### Three "keep it thin" guardrails (the standard for this slice)

1. **One perception → one decision → one gated action.** Anchor: *complaint in → triage → draft a reply, gated.*
2. **The gated action is a recorded intent (ADR-0007 outbox), never a real send.** Zero outward effect, full glass-box value.
3. **The LLM decision is recorded as an event (ADR-0007: record-the-result)** so replay stays deterministic. Confidence starts as a **placeholder**: the slice wires the *chain* (`DecisionProposed → ConfidenceAssessed → Acted|Escalated → OutcomeObserved`) and the *gate*, **not** perfect calibration. Calibration comes later.

## 3. Components & boundaries

New organ: **`src/organs/cortex/`**, parallel to `src/organs/mcp/`. Three small, independently
testable units:

- **`Decider` (interface)** — `propose(context) → { draft: string; confidence: number }`.
  The **model-agnostic seam** (§3.5): a stable contract; every provider (Anthropic, OpenAI,
  local vLLM/Ollama, an EU API) becomes an interchangeable implementation. **No vendor SDK leaks
  into the core.** This slice ships only `FakeDecider` (scripted, deterministic).
  - *What it does:* turns a perceived context into one proposal. *How you use it:* inject it into
    the orchestrator. *Depends on:* nothing (pure).
- **`gate` (pure function)** — `(tier, confidence, threshold) → "act" | "escalate"`. The action-tier
  floor first (ADR-0010), confidence modulates within the tier. The action "draft a reply to a
  complaint" is **T3** (external / irreversible to a third party). Threshold is a config constant
  (placeholder, e.g. `0.8`). *Depends on:* nothing (pure).
- **`Cortex.run(complaintId)` (orchestrator)** — perceive → `Decider.propose` → write the chain →
  `gate` → `Acted | Escalated`. *Depends on:* a `Mark` instance + a `Decider`. It reads by folding
  the object's own events (`load`/`read`), per ADR-0004 ("the act loop bypasses projections") — so
  it needs **no** Layer-2 projection framework.

## 4. Events & projection

New variants added to the `MarkEvent` discriminated union (`event.ts`) with matching zod schemas
(`event-schema.ts`):

| Event | Payload | Role |
|---|---|---|
| `DecisionProposed` | `{ draft, perceivedObjectId, perceivedSeq }` | the **recorded LLM output** (record-the-result); root of the run's correlation. The action type is fixed to "draft a reply" in this slice — no `action` discriminator yet (YAGNI; added when a second action type appears). |
| `ConfidenceAssessed` | `{ confidence, threshold, tier }` | the gate inputs; causation → `DecisionProposed` |
| `Acted` | `{ draftRef }` | gate released: `draftRef` = the `eventId` of the `DecisionProposed` whose draft is now the released intent (no dispatcher) |
| `Escalated` | `{ reason }` | gate held: nothing released, awaits a human |
| `OutcomeObserved` | `{ wasCorrect, evidence? }` | loop-closer (ADR-0010); appended by a separate human action, not automatically |

**Projection — 2B-lite (chosen).** The decision trace is a **separate projection from day one**,
not a facet of `ObjectState`. The decisive reason: the decision trace is keyed by `correlationId`
(the episode), while `ObjectState` is keyed by `objectId` — two different keys. Folding a
`correlationId`-keyed thing into an `objectId`-keyed projection is concern-mixing, and ADR-0004 is
explicit that cross-object read models are *separate, named projections* (the act loop folds
per-object via `load`; everything else is its own projection). This slice is the first chance to
build the second example of that world (after `list_objects`), so it should — not undercut the very
architecture it exists to pressure-test.

Concretely:

- **`ObjectState` stays field-clean** — no `decision` field is added. *Honest caveat:* because the
  decision events live on the complaint's stream (Decision 5A), `applyEvent`'s exhaustive switch
  **must** still handle them. They are folded as **pass-through arms that bump `version` but change
  no domain field**. So `ObjectState` stays field-clean, but its `version` counts the decision
  events too (they *are* events in the stream — this is correct and must be stated, not a surprise).
- **A separate `replayDecision(events) → DecisionEpisode | null`** fold, keyed by `correlationId`:
  ```
  DecisionEpisode = {
    episode: string;             // correlationId of the run
    status: "proposed" | "acted" | "escalated";
    draft: string | null;        // the proposed reply, when acted
    confidence: number | null;
    perceivedObjectId: string;
    perceivedSeq: number;
    outcome?: { wasCorrect: boolean };
  }
  ```
  In-memory only, no persistence, no Layer-2 framework — the *same* fold logic 2A would have used,
  just in its own function instead of inside `applyEvent`.
- **The organ merges both reads.** `get_object`'s "a draft is pending / escalated" feature is the
  organ reading `load(id)` **and** `replayDecision(read(id))` and combining them — the glass-box
  value is preserved without loading up the core projection.

**Evolution path 2B-lite → full 2B (recorded deferral, migration-free).** Later the same fold
becomes a **persisted, cross-object** projection (folding `correlationId` across all object streams)
once the Layer-2 framework exists. Because the events are the single source of truth, this is purely
a read-side change with **zero data migration** (the ADR-0004 / ADR-0005 payoff). **Trigger:**
Layer 2 exists **and** decision traces must be queried cross-object (e.g. "all escalations this
week", or folding `ConfidenceAssessed` + `OutcomeObserved` into the per-action-type calibration
curve of ADR-0010).

**Schema + type-guard discipline (one step).** Adding the five variants to the `MarkEvent` union
**forces** matching updates to `event-schema.ts` (a zod schema per variant) and the
`Equal<MarkEvent, SchemaEvent>` compile guard, in the **same change** — `tsc` breaks otherwise. The
plan must instruct: extend the union, the zod schemas, and the guard together; do not "fix" one side
in isolation.

## 5. Control flow & resume

1. **Perceive:** `load(complaintId)`; remember the observed `seq`.
2. **Memoize-in-the-small (guardrail 3):** check the object's events for an existing
   `DecisionProposed` for this run; if present, skip the LLM call and use the recorded output.
   Replay never re-rolls the LLM.
3. **Decide:** `Decider.propose(context)` → append `DecisionProposed{ draft, perceivedSeq }` under a
   fresh `correlationId` (the episode).
4. **Assess:** append `ConfidenceAssessed{ confidence, threshold, tier: "T3" }`
   (causation → `DecisionProposed`).
5. **Gate:** above threshold → `Acted{ draftRef }` (intent recorded, **no dispatcher**, zero outward
   effect — guardrail 2). Below threshold → `Escalated{ reason }`.
6. Appends carry idempotency keys (Layer 1) → retries are no-ops.

`OutcomeObserved` is **not** written automatically — a separate small action lets a human append
"draft was good/bad". The chain stays complete; calibration is deliberately out.

## 6. Testing (TDD, both adapters in parity)

Written test-first, like the kernel; `load == replay(read)` must continue to hold on **both**
in-memory and PostgreSQL adapters, including the new events.

- **`gate` (pure):** above/below threshold; the T3 floor.
- **`replayDecision` (pure fold):** the chain `DecisionProposed → ConfidenceAssessed → Acted` folds
  to a `DecisionEpisode` with `status: "acted"` and `draft` set; the escalated chain folds to
  `status: "escalated"` with `draft: null`; a stream with no decision events folds to `null`.
- **`Cortex.run` — Acted path:** `FakeDecider` returns high confidence → chain
  `DecisionProposed → ConfidenceAssessed → Acted`; the intent is recorded; **nothing is dispatched**.
- **`Cortex.run` — Escalated path:** `FakeDecider` returns low confidence → ends in `Escalated`;
  no draft released.
- **`ObjectState` stays field-clean:** after a run, `load(id)` exposes **no** decision field; its
  `version` has advanced by the number of decision events folded (pass-through bumps version only).
- **Organ merge:** `get_object` combines `load(id)` + `replayDecision(read(id))` and surfaces
  "draft pending / escalated".
- **Replay determinism / idempotency:** a second `run` (retry) does **not** re-roll the LLM; appends
  are idempotent (no duplicate chain).
- **`load == replay(read)`** holds on both adapters with the new event types folded.
- **`examples/cortex-demo.ts`** makes the whole arc visible, reproducibly, with no API key.

## 7. Explicitly out of scope (the thin cuts)

Each returns when a workflow genuinely demands it:

- A **real LLM adapter** (clean follow-up; the `Decider` seam is the whole point so any model attaches later).
- A **generic step journal / resume machinery** (ADR-0007's full memoization loop).
- A **real transactional outbox + relay** (ADR-0007); here the intent is recorded, no dispatcher exists.
- **Confidence calibration** (ADR-0010 `OutcomeObserved` folding).
- The **cross-object "case"** model (deliberately open per the dogfooding finding).
- The **Layer-2 projection framework** (ADR-0004) and **Schema-morph** (ADR-0005).
- The **Senses** (intake / extraction).

## 8. Invariant check

- **Events are truth; state derived.** ✅ The `DecisionEpisode` is folded from the new events by a
  separate projection; the events are the only writes. `ObjectState` stays field-clean (separation
  of concerns — ADR-0004 "many named projections").
- **Glass-box.** ✅ `DecisionProposed` records the proposal + perceived `seq`; `ConfidenceAssessed`
  records the gate inputs; the full episode is reconstructable from the Mark.
- **Autonomy is gated.** ✅ T3 floor + threshold; below threshold escalates. High confidence never
  buys past the tier (the tier floor is honored even though calibration is a placeholder).
- **Durable by default.** ✅ Record-the-result + idempotent appends make `run` replay-safe and
  retry-safe (the thin form of ADR-0007).
- **Sovereign / model-agnostic.** ✅ The `Decider` seam keeps the core free of any vendor SDK.
- **MCP both directions / one substrate.** ✅ No new closed integration; the decision facet is
  generic, not a per-domain fork.
