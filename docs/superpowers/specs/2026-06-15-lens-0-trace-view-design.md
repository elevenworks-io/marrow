# Lens 0 — the Trace-View (design)

- **Date:** 2026-06-15
- **Status:** design, review-hardened (3 independent reviews folded in), awaiting Noah's sign-off
- **Organ:** `src/organs/lens/` (new) — the first step of **Lens**, a Mark-native,
  Langfuse-*inspired* observability layer built inside the repo (no external
  Langfuse; the Mark is the trace, never a second journal).
- **Depends on / cites:** VISION §2 (the auditor moment), §3.1 (the Mark is the
  single source of truth), §3.2 (glass-box), §3.3 (confidence-gated autonomy);
  ADR-0009 (Lens *renders* the audit read — as-of / correlation lineage; no
  separate audit subsystem); ADR-0004 (a named, rebuildable projection — 2B-lite,
  in-memory here, like `replayDecision`).

## 1. What Lens 0 is

A **pure, read-only projection + renderer** that folds an event stream into a
Langfuse-style **causal forest** and renders it as a legible, glass-box trace of
*what the agent did and why*. It is to a decision episode what `replayDecision`
is to the episode's status: a fold over events, computing nothing it cannot
reconstruct, persisting nothing. The trace **is** the events.

It is deliberately the smallest step on the Lens ladder (Lens 1 = write-time
cost/token/latency enrichment; Lens 2 = scores + the confidence-calibration loop,
where the separate calibration track converges; Lens 3 = datasets/experiments,
the Time-Machine seed; Lens 4 = dashboards / the Skin surface).

## 2. The grounding facts (verified against the code)

These shaped every decision below; they corrected the first-draft design.

- **Lineage** (`src/mark/log.ts:36`): a root event is its own `correlationId`
  with `causationId: null`; a caused event inherits its cause's `correlationId`
  and points `causationId` at the cause's `eventId`.
- **The decision chain** (`src/organs/cortex/cortex.ts:82`): `DecisionProposed`
  is a **root** (no `causedBy`); `ConfidenceAssessed` is caused by it;
  `Acted`/`Escalated` by `ConfidenceAssessed`. One correlation, fan-out of 1 at
  every node — a straight line. The Cortex **never appends `OutcomeObserved`**
  today (it closes the calibration loop later, Lens 2), so an episode's outcome is
  usually absent.
- **Object creation** (`src/organs/mcp/service.ts:36`): `ObjectCreated` is a root;
  each initial `AttributeSet` is `causedBy` it → a shallow **star** (one root, N
  children), all sharing `ObjectCreated.eventId` as correlation. This is the
  *only* fan-out > 1 the codebase produces. Later `setAttribute`/`changeState`/
  `addNote` are independent roots.
- **Cross-object causation is NOT threaded yet** (capability-map finding): every
  separate call is its own lineage root; no event's `causationId` ever points
  outside its own object stream today.
- **`readCorrelation(correlationId)`** (`src/mark/log.ts:86`, on the `Mark`
  interface, both adapters) returns exactly one case's events in global order —
  the natural source for a single-episode view.

**Consequence — honest framing:** a complaint created then run through the Cortex
has a stream with **two correlations**: the creation star and the decision chain.
`replayTrace` over it yields a **forest of two roots**, not one deep tree. Today's
trees are shallow; *the value of Lens 0 is the legibility of the "why," not graph
structure.* The forest model is correct and future-proof (it merges cross-object
chains for free once threaded), but Lens 0 earns its keep by making the gate
decision, the draft, the perceived context, and the outcome **readable** — not by
drawing a deep tree that does not exist yet.

## 3. Core primitive — `replayTrace`

```ts
type TraceForest = readonly TraceNode[]; // roots, sorted by (globalSeq, eventId)

interface TraceNode {
  eventId: string;
  correlationId: string;        // foresight: Lens 2/3 group episodes by this
  causationId: string | null;
  type: MarkEventType;
  seq: number;
  globalSeq: number;
  objectId: string;             // forest is objectId-agnostic; node records its origin
  occurredAt: string;           // raw truth; NO derived duration in Lens 0 (see §6)
  actor: string;
  confidence?: number;          // ConfidenceAssessed → payload; else metadata.confidence
  tier?: ActionTier;            // only on ConfidenceAssessed (no other source)
  externalCause?: string;       // a dangling causationId (forward-looking — see §5)
  summary: string;              // exhaustive over the union (never-check)
  event: MarkEvent;             // full payload kept (glass-box; render decides what to show)
  metadata: EventMetadata;      // full passthrough kept
  children: readonly TraceNode[];
}

function replayTrace(events: readonly RecordedEvent[]): TraceForest;
```

**Algorithm (pure, order-independent):**

1. Sort input by `(globalSeq, eventId)`. `globalSeq` is a unique total order on a
   single Mark; `eventId` is the tiebreak insurance against merged streams.
2. Build an `eventId → TraceNode` map. **Duplicate `eventId` → throw** (corruption
   signal; mirrors `parseMarkEvent`'s loud-failure discipline).
3. Attach each node to its parent by `causationId`:
   - `causationId === null` → a **true root**.
   - `causationId` present in the map → append to that parent's `children`
     (keyed by `eventId`, **objectId-agnostic** — a cross-object causal edge merges
     the two chains into one tree, by design).
   - `causationId` present but **absent from the map** → a **root** flagged
     `externalCause: <causationId>` (a dangling pointer; see §5).
4. **Explicitly sort** every `children[]` and the root list by `(globalSeq,
   eventId)`. Never rely on incidental append/iteration order.

`replayTrace` must be a **function of the event array alone** — shuffle the input,
get an identical forest. This is a first-class invariant test (mirrors
`load == replay(read)`); it guarantees no hidden ordering state can accrete.

**`summary(event)`** is a `switch` **exhaustive** over `MarkEvent["type"]` with a
`const _exhaustive: never = event` default — adding an event variant becomes a
compile error (project hard rule: a new variant forces handling). One-line
essence per type (draft for `DecisionProposed`, `confidence vs threshold (tier)`
for `ConfidenceAssessed`, reason for `Escalated`, `wasCorrect + evidence` for
`OutcomeObserved`, `key=value` for `AttributeSet`, etc.).

## 4. The episode header — per `correlationId`

The tree is built on `causationId`; the **header must be built on the same
grouping** or it will tell a different story. `replayDecision` folds a whole
object stream and keeps the *last* `DecisionProposed` ("at most one episode per
object") — feeding it a multi-correlation object stream would collapse multiple
runs to last-wins while the forest correctly shows both. So:

```ts
interface EpisodeSummary {
  correlationId: string;
  status: "proposed" | "acted" | "escalated";
  gateVerdict: "act" | "escalate" | null;   // = status mapped; null while proposed
  confidence: number | null;
  threshold: number | null;                  // restored from ConfidenceAssessed
  tier: ActionTier | null;
  draft: string | null;
  perceivedObjectId: string | null;          // restored from DecisionProposed
  perceivedSeq: number | null;
  outcome?: { wasCorrect: boolean; evidence: string | null }; // evidence restored
}

function summarizeEpisodes(events: readonly RecordedEvent[]): readonly EpisodeSummary[];
```

`summarizeEpisodes` groups events by `correlationId`; for each correlation that
contains a `DecisionProposed`, it **reuses `cortex/replayDecision`** on that
correlation's slice (the one-episode-per-slice assumption now holds — do not
re-implement the state machine) and **supplements the audit fields
`replayDecision` deliberately drops**: `threshold`/`tier` from `ConfidenceAssessed`,
`evidence` from `OutcomeObserved`, `perceivedObjectId`/`perceivedSeq` from
`DecisionProposed`. The single-episode view is `replayTrace(await
mark.readCorrelation(corrId))` + `summarizeEpisodes(sameEvents)`.

**Coupling:** Lens imports `replayDecision` / `DecisionEpisode` from
`../cortex/index.js`. Clean DAG (cortex does not import lens); Lens observes the
Cortex's decisions, so the dependency is conceptually right. If the decision
projection later needs sharing beyond cortex, lift it to a shared module — not now.

## 5. `externalCause` — forward-looking, honestly labelled

Today **no** event's `causationId` points outside its own object stream, so the
`externalCause` branch is **untriggerable by current data**. It is kept as the
correct hook for ADR-0009 cross-object cases, with two honesty rules:

- It is set **only** when `causationId !== null` **and** the target is absent from
  the input — a genuine dangling pointer. It is never conflated with a true
  `causationId === null` root, nor with legitimate **cross-object causation where
  the parent IS present** (that links normally — the forest is objectId-agnostic).
- It is exercised by a **deliberately-sliced fixture** (a stream with a parent
  removed), not pretended to arise from normal data. The demo and docs state it is
  forward-looking.

## 6. Timing — deliberately omitted in Lens 0 (reversed by review)

The first draft planned a wall-clock Δ between causally-linked events. Review
showed it would **mislead**: the model call happens inside `decider.propose`
*before* `DecisionProposed` is recorded, and the chain events are appended
back-to-back synchronously — so any Δ between recorded decision events is
microseconds and reads falsely as "the agent thought for 2 ms." Shipping a number
that lies violates glass-box more than omitting it.

**Decision:** Lens 0 ships **no derived or rendered duration**. Each node keeps
`occurredAt` raw (truth; a consumer may compute deltas), but nothing surfaces a
latency. Real per-step latency arrives in **Lens 1** (captured into metadata at
write time, where it is honest). This also removes the negative-duration,
NaN-parse, and externalCause-duration edge cases entirely.

## 7. Render & output — structure first

The **primary artifact is the structured `TraceForest` + `EpisodeSummary[]`**.
Renderers are consumers:

- `renderTrace(forest, episodes) → string` — plain text (no ANSI in the function
  → deterministic, snapshot-testable). The `examples/lens-trace.ts` demo adds
  color/banner (NO_COLOR-aware) like `cortex-demo.ts`.
- JSON output (`JSON.stringify(forest)`) — a near-free gesture toward the future
  Skin / Lens 3-4 (`npm run lens -- --json`).

The text render must make the **"why" first-class** (the four reviewer must-adds —
without them Lens 0 is a prettier `get_history`):

1. **The gate verdict, explicit:** `confidence 0.72 vs threshold 0.80 →
   ESCALATED (T3)`, with the escalation `reason` verbatim.
2. **The draft** (the action the agent proposed) and the **perceived context**
   pointer (`perceived complaint-101 @seq 2`), both legible, not raw metadata.
3. **A one-line human-readable episode header** per episode (the headline; the
   chain below is the proof) — e.g. *"complaint-101 — agent ACTED (0.90 ≥ 0.80,
   T3) — outcome: —"*.
4. **`OutcomeObserved` with its `evidence`**, not just the `wasCorrect` bit.

Domain events (`ObjectCreated`/`AttributeSet`/`StateChanged`/`NoteAdded`) are
rendered as **dimmed context** roots — the object the agent acted *on* — **not**
hard-filtered the way `replayDecision` drops them. A one-line on-thesis footer
states the trace was *"reconstructed from N events — no second source of truth"*
(§3.1 gesture).

## 8. Module layout

- `src/organs/lens/trace.ts` — `TraceNode`, `TraceForest`, `replayTrace`,
  `summaryOf` (exhaustive).
- `src/organs/lens/episode.ts` — `EpisodeSummary`, `summarizeEpisodes` (reuses
  `cortex/replayDecision`).
- `src/organs/lens/render.ts` — `renderTrace(forest, episodes) → string`.
- `src/organs/lens/index.ts` — public surface.
- `examples/lens-trace.ts` + `package.json` script `"lens": "tsx
  examples/lens-trace.ts"` — FakeDecider, no API key; seeds via `causedBy` so the
  creation star shows; runs one acted + one escalated episode; prints the trace
  and supports `--json`.
- Tests: `src/organs/lens/trace.test.ts`, `episode.test.ts`, `render.test.ts`.

No new runtime dependencies. SPDX header on every new file.

## 9. Tests (TDD order)

Build authentic events via a real `InMemoryMark` + `MarkService.createObject` +
`Cortex` (integration realism), and hand-built `RecordedEvent` fixtures for the
adversarial edges.

- **`replayTrace`**: linear decision chain → one branch; creation star → one root
  with N children; full complaint stream → forest of two roots (creation star +
  decision chain). **Shuffle-invariance** → identical forest (first-class
  invariant). Sibling/root order is `(globalSeq, eventId)`. Duplicate `eventId` →
  throws. Cross-object causal edge (fixture) → trees **merge** into one (proves
  objectId-agnostic keying). Dangling `causationId` (sliced fixture) → root flagged
  `externalCause`, never confused with a `null` root. Degenerate: empty → empty;
  single; all-roots; all-orphans.
- **`summaryOf`**: a case per `MarkEvent` type; exhaustiveness enforced by the
  `never` default (compile-time).
- **`summarizeEpisodes`**: single episode (acted / escalated / proposed-only);
  restores `threshold`, `tier`, `evidence`, `perceived*`; **two episodes on one
  object → two summaries** (no last-wins collapse); object with no decision → `[]`;
  empty → `[]`.
- **`renderTrace`**: snapshot for an **acted** and an **escalated** episode —
  asserts the gate verdict line, draft, perceived pointer, episode header, and the
  dimmed domain context appear; outcome+evidence line when present; empty forest →
  no-op header (no stray episode line).
- **Cycle guard**: a hand-built cyclic fixture → `renderTrace` terminates (visited
  set), surfacing the cycle rather than stack-overflowing.

## 10. Out of scope (YAGNI / later Lens steps)

cost / token / real latency (Lens 1) · scores beyond events, ECE / reliability /
calibration (Lens 2, where the calibration track converges) · datasets /
experiments (Lens 3) · cross-episode aggregation / dashboards (Lens 4) · MCP
exposure of Lens views · persistence / OLAP read store · cross-object causal
*threading* (a Cortex/substrate change, ADR-0009 — Lens only *renders* it once it
exists).
