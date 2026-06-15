# Cortex Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the thinnest agent loop — MARROW's own Cortex perceives a complaint, decides (draft + confidence), gates on action tier T3, and records the full decision chain on the Mark — putting the provisional ADRs 0007/0009/0010 under real, agent-produced pressure.

**Architecture:** A new organ `src/organs/cortex/` parallel to `mcp/`. Three small units: a model-agnostic `Decider` seam (fake-only here), a pure `gate` (action-tier floor + confidence), and a `Cortex.run` orchestrator. Five new decision-chain event types are added to the Mark; `ObjectState` stays field-clean (they fold as version-only pass-through), and a *separate* `replayDecision` projection (keyed by `correlationId`) folds the decision trace (2B-lite). No real side effect leaves the system — "act" records a draft *intent*, with no dispatcher.

**Tech Stack:** TypeScript (strict), Node LTS, Vitest, Zod, PostgreSQL (`pg`). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-15-cortex-slice-design.md`. Read it first — it carries the locked scope, the three "keep it thin" guardrails, and the invariant check.

**Branch:** `feat/cortex-slice` (already created off `main`; the spec lives there).

**Conventions to match (from the existing kernel):**
- Every source file starts with the two-line SPDX header:
  ```
  // SPDX-License-Identifier: AGPL-3.0-or-later
  // Copyright (C) 2026 elevenworks
  ```
- Imports of sibling modules use the `.js` extension (ESM): `import { gate } from "./gate.js";`.
- Tests are Vitest: `import { describe, it, expect } from "vitest";`.
- Run one test file: `npx vitest run <path>`. Run all: `npm test`. Typecheck: `npm run typecheck`.
- Postgres tests are gated on `MARROW_TEST_DATABASE_URL` (`describe.skipIf(!url)`); bring a DB up with `npm run db:up` and export the URL before Task 7.

---

## File structure

| File | Responsibility |
|---|---|
| `src/mark/event.ts` (modify) | add `ActionTier` + 5 decision event variants to the `MarkEvent` union |
| `src/mark/event-schema.ts` (modify) | add 5 strict zod schemas (runtime boundary) |
| `src/mark/upcasting.ts` (modify) | add 5 entries to `MARK_CURRENT` (compiler-forced via `satisfies`) |
| `src/mark/projection.ts` (modify) | add version-only pass-through arms (compiler-forced via the `never` switch) |
| `src/mark/index.ts` (modify) | re-export `ActionTier` |
| `src/mark/projection.test.ts` (modify) | test the pass-through fold keeps `ObjectState` field-clean |
| `src/mark/postgres.test.ts` (modify) | parity: the decision chain round-trips; `load == replay(read)` holds |
| `src/organs/cortex/gate.ts` (create) | pure autonomy gate: tier floor + confidence |
| `src/organs/cortex/gate.test.ts` (create) | gate behaviour incl. "confidence ≠ permission" |
| `src/organs/cortex/decider.ts` (create) | `Decider` seam + `FakeDecider` |
| `src/organs/cortex/decider.test.ts` (create) | fake returns scripted proposal, counts calls |
| `src/organs/cortex/decision.ts` (create) | `replayDecision` — the separate decision-trace projection |
| `src/organs/cortex/decision.test.ts` (create) | fold acted/escalated/none |
| `src/organs/cortex/cortex.ts` (create) | `Cortex.run` orchestrator |
| `src/organs/cortex/cortex.test.ts` (create) | acted, escalated, idempotent/no-re-roll, perceive-missing |
| `src/organs/cortex/read.ts` (create) | `readObjectWithDecision` — the 2B-lite merge |
| `src/organs/cortex/read.test.ts` (create) | merged view: state field-clean + decision present |
| `src/organs/cortex/index.ts` (create) | organ barrel |
| `examples/cortex-demo.ts` (create) | runnable, no-API-key arc (acted + escalated) |
| `package.json` (modify) | add `cortex:demo` script |
| `docs/mark-capability-map.md` (modify) | record the slice as built + a findings stub |

---

## Task 1: Add the decision-chain events to the Mark event model

Adding the five variants touches four kernel files **in one change** — `tsc` will not compile otherwise. Two guards are compiler-enforced: `MARK_CURRENT satisfies Record<MarkEventType, number>` (upcasting.ts) and the exhaustive `never` switch (projection.ts). The zod schema (event-schema.ts) is **not** compiler-checked against the union — it is enforced at runtime and is caught by the Postgres round-trip tests (Task 7). So: change the union, the zod schemas, the version registry, and the projection together; do not "fix" one side in isolation.

**Files:**
- Modify: `src/mark/event.ts`
- Modify: `src/mark/event-schema.ts`
- Modify: `src/mark/upcasting.ts`
- Modify: `src/mark/projection.ts`
- Modify: `src/mark/index.ts`
- Test: `src/mark/projection.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test to `src/mark/projection.test.ts` (inside the existing top-level `describe`, or as a new `describe`):

```typescript
it("folds decision-chain events as version-only pass-through (ObjectState stays field-clean)", () => {
  const state = replay([
    { type: "ObjectCreated", id: "c1", objectType: "complaint" },
    { type: "AttributeSet", key: "text", value: "my order never arrived" },
    { type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 2 },
    { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" },
    { type: "Acted", draftRef: "evt-1" },
  ]);

  expect(state.version).toBe(5);
  expect(state.attributes).toEqual({ text: "my order never arrived" });
  expect(state.state).toBeNull();
  expect("decision" in state).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail (type error)**

Run: `npm run typecheck`
Expected: FAIL — the new event types are not in `MarkEvent`, so the object literals are not assignable.

- [ ] **Step 3: Add `ActionTier` and the five variants to the union**

In `src/mark/event.ts`, add the `ActionTier` type just above `MarkEvent`, and extend the union:

```typescript
/** The action-risk tier that sets the autonomy floor (ADR-0010). */
export type ActionTier = "T1" | "T2" | "T3" | "T4";

/** The domain event: *what happened* to an object. */
export type MarkEvent =
  | { readonly type: "ObjectCreated"; readonly id: string; readonly objectType: string }
  | { readonly type: "AttributeSet"; readonly key: string; readonly value: Json }
  | { readonly type: "StateChanged"; readonly state: string }
  | { readonly type: "NoteAdded"; readonly text: string }
  // Agent decision chain (ADR-0010), recorded on the acted-upon object's stream.
  | {
      readonly type: "DecisionProposed";
      readonly draft: string;
      readonly perceivedObjectId: string;
      readonly perceivedSeq: number;
    }
  | {
      readonly type: "ConfidenceAssessed";
      readonly confidence: number;
      readonly threshold: number;
      readonly tier: ActionTier;
    }
  | { readonly type: "Acted"; readonly draftRef: string }
  | { readonly type: "Escalated"; readonly reason: string }
  | { readonly type: "OutcomeObserved"; readonly wasCorrect: boolean; readonly evidence?: string };
```

- [ ] **Step 4: Add the five zod schemas**

In `src/mark/event-schema.ts`, extend the `markEventSchema` discriminated union (append after the `NoteAdded` line):

```typescript
  z.object({
    type: z.literal("DecisionProposed"),
    draft: z.string(),
    perceivedObjectId: z.string(),
    perceivedSeq: z.number(),
  }).strict(),
  z.object({
    type: z.literal("ConfidenceAssessed"),
    confidence: z.number(),
    threshold: z.number(),
    tier: z.enum(["T1", "T2", "T3", "T4"]),
  }).strict(),
  z.object({ type: z.literal("Acted"), draftRef: z.string() }).strict(),
  z.object({ type: z.literal("Escalated"), reason: z.string() }).strict(),
  z.object({
    type: z.literal("OutcomeObserved"),
    wasCorrect: z.boolean(),
    evidence: z.string().optional(),
  }).strict(),
```

- [ ] **Step 5: Add the version entries (compiler-forced)**

In `src/mark/upcasting.ts`, extend `MARK_CURRENT`:

```typescript
const MARK_CURRENT = {
  ObjectCreated: 1,
  AttributeSet: 1,
  StateChanged: 1,
  NoteAdded: 1,
  DecisionProposed: 1,
  ConfidenceAssessed: 1,
  Acted: 1,
  Escalated: 1,
  OutcomeObserved: 1,
} satisfies Record<MarkEventType, number>;
```

- [ ] **Step 6: Add the pass-through arms (compiler-forced)**

In `src/mark/projection.ts`, add these cases to the `switch (event.type)` in `applyEvent`, immediately before the `default:` arm:

```typescript
    case "DecisionProposed":
    case "ConfidenceAssessed":
    case "Acted":
    case "Escalated":
    case "OutcomeObserved":
      // Agent decision-chain events (ADR-0010) live on the object's stream but
      // are not domain mutations: a separate projection (replayDecision) folds
      // them, keyed by correlationId. Here they only advance the version, so
      // ObjectState stays field-clean (ADR-0004: decision/cross-object read
      // models are their own named projections, not facets of ObjectState).
      return Object.freeze({ ...state, version });
```

- [ ] **Step 7: Re-export `ActionTier`**

In `src/mark/index.ts`, add `ActionTier` to the type re-export from `./event.js`:

```typescript
export type { Json, MarkEvent, MarkEventType, EventMetadata, RecordedEvent, ActionTier } from "./event.js";
```

- [ ] **Step 8: Run the test and the typecheck**

Run: `npx vitest run src/mark/projection.test.ts && npm run typecheck`
Expected: PASS — the new test passes and the project type-checks.

- [ ] **Step 9: Run the full in-memory suite (no regressions)**

Run: `npm test`
Expected: PASS (Postgres tests skip without a DB URL — that is fine here).

- [ ] **Step 10: Commit**

```bash
git add src/mark/event.ts src/mark/event-schema.ts src/mark/upcasting.ts src/mark/projection.ts src/mark/index.ts src/mark/projection.test.ts
git commit -m "feat(mark): add the agent decision-chain event types

Five variants (DecisionProposed, ConfidenceAssessed, Acted, Escalated,
OutcomeObserved) for the Cortex's decision chain (ADR-0010), recorded on the
acted-upon object's stream. They fold as version-only pass-through, so
ObjectState stays field-clean — the decision trace is a separate projection.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: The autonomy gate

The gate is the heart of ADR-0010: the action *tier* sets the floor, confidence only modulates within it. "Confidence ≠ permission" — a high-confidence T4 action is still escalated. The slice uses T3 for "draft a reply", but implementing all four tiers is the honest shape and a few lines.

**Files:**
- Create: `src/organs/cortex/gate.ts`
- Test: `src/organs/cortex/gate.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/organs/cortex/gate.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { gate } from "./gate.js";

describe("gate", () => {
  it("T3 acts at or above the threshold", () => {
    expect(gate("T3", 0.8, 0.8)).toBe("act");
    expect(gate("T3", 0.95, 0.8)).toBe("act");
  });

  it("T3 escalates below the threshold", () => {
    expect(gate("T3", 0.5, 0.8)).toBe("escalate");
  });

  it("T1 and T2 act regardless of confidence", () => {
    expect(gate("T1", 0, 0.8)).toBe("act");
    expect(gate("T2", 0, 0.8)).toBe("act");
  });

  it("T4 escalates even at full confidence — confidence is not permission", () => {
    expect(gate("T4", 1, 0.8)).toBe("escalate");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/organs/cortex/gate.test.ts`
Expected: FAIL — cannot find module `./gate.js`.

- [ ] **Step 3: Implement the gate**

Create `src/organs/cortex/gate.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The autonomy gate (ADR-0010). The action *risk tier* sets the floor;
 * confidence only modulates within a tier. "Confidence ≠ permission": a
 * high-confidence T4 action is still escalated. Calibration is out of scope for
 * this slice — `threshold` is a tunable input, not yet empirically fit.
 */

import type { ActionTier } from "../../mark/index.js";

export type GateOutcome = "act" | "escalate";

export function gate(tier: ActionTier, confidence: number, threshold: number): GateOutcome {
  switch (tier) {
    case "T1": // read-only
    case "T2": // reversible-internal
      return "act";
    case "T3": // external / irreversible to third parties (e.g. an outbound reply)
      return confidence >= threshold ? "act" : "escalate";
    case "T4": // high-risk irreversible — human approval, no exceptions
      return "escalate";
    default: {
      const unreachable: never = tier;
      throw new Error(`unknown action tier: ${String(unreachable)}`);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/organs/cortex/gate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/organs/cortex/gate.ts src/organs/cortex/gate.test.ts
git commit -m "feat(cortex): the autonomy gate — tier floor + confidence (ADR-0010)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: The Decider seam

The model-agnostic seam (§3.5): the LLM as a pure function `(context) → proposal`. Every provider becomes an interchangeable `Decider`; no vendor SDK enters the core. This slice ships only the deterministic `FakeDecider`.

**Files:**
- Create: `src/organs/cortex/decider.ts`
- Test: `src/organs/cortex/decider.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/organs/cortex/decider.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { FakeDecider } from "./decider.js";

describe("FakeDecider", () => {
  it("returns its scripted proposal and counts calls", async () => {
    const decider = new FakeDecider({ draft: "Sorry to hear that.", confidence: 0.9 });

    const proposal = await decider.propose({ objectId: "c1", seq: 2, text: "late delivery" });

    expect(proposal).toEqual({ draft: "Sorry to hear that.", confidence: 0.9 });
    expect(decider.calls).toBe(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/organs/cortex/decider.test.ts`
Expected: FAIL — cannot find module `./decider.js`.

- [ ] **Step 3: Implement the seam and the fake**

Create `src/organs/cortex/decider.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The model-agnostic decision seam (§3.5). The Cortex treats the LLM as a pure
 * function `(context) → proposal` (ADR-0007): the result is recorded as an
 * event, so a replay or retry never re-rolls it. Every provider — Anthropic,
 * OpenAI, a local vLLM/Ollama model, an EU API — is an interchangeable
 * `Decider`; no vendor SDK leaks into the core. This slice ships only the
 * deterministic `FakeDecider`; a real adapter is a clean follow-up behind the
 * same interface.
 */

/** What the Cortex perceived, handed to the decider. */
export interface DecisionContext {
  readonly objectId: string;
  readonly seq: number;
  readonly text: string;
}

/** The decider's single output: a draft reply + a self-assessed confidence. */
export interface Proposal {
  readonly draft: string;
  readonly confidence: number;
}

/** A model that turns a perceived context into one proposal. */
export interface Decider {
  propose(context: DecisionContext): Promise<Proposal>;
}

/** A scripted, deterministic decider for tests and the no-API-key demo. */
export class FakeDecider implements Decider {
  #calls = 0;

  constructor(private readonly proposal: Proposal) {}

  /** How many times `propose` has been called — proves replay does not re-roll. */
  get calls(): number {
    return this.#calls;
  }

  async propose(_context: DecisionContext): Promise<Proposal> {
    this.#calls += 1;
    return this.proposal;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/organs/cortex/decider.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/organs/cortex/decider.ts src/organs/cortex/decider.test.ts
git commit -m "feat(cortex): the model-agnostic Decider seam + FakeDecider (§3.5)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: The decision-trace projection (replayDecision)

The 2B-lite separation: the decision chain is folded by its *own* projection, keyed by `correlationId`, not into `ObjectState`. In-memory only here; the same fold becomes a persisted, cross-object projection when Layer 2 lands — migration-free, since the events are the truth.

**Files:**
- Create: `src/organs/cortex/decision.ts`
- Test: `src/organs/cortex/decision.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/organs/cortex/decision.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { replayDecision } from "./decision.js";

/** Build a minimal RecordedEvent for folding tests. */
function rec(event: MarkEvent, seq: number, correlationId = "run-1"): RecordedEvent {
  return {
    eventId: `evt-${seq}`,
    correlationId,
    causationId: null,
    globalSeq: seq,
    objectId: "c1",
    seq,
    schemaVersion: 1,
    event,
    metadata: { actor: "cortex" },
    occurredAt: "2026-06-15T00:00:00.000Z",
    recordedAt: "2026-06-15T00:00:00.000Z",
  };
}

describe("replayDecision", () => {
  it("folds the acted chain into an episode with the draft and confidence", () => {
    const episode = replayDecision([
      rec({ type: "ObjectCreated", id: "c1", objectType: "complaint" }, 1),
      rec({ type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 1 }, 2),
      rec({ type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" }, 3),
      rec({ type: "Acted", draftRef: "evt-2" }, 4),
    ]);

    expect(episode).toEqual({
      episode: "run-1",
      status: "acted",
      draft: "We're sorry…",
      confidence: 0.9,
      perceivedObjectId: "c1",
      perceivedSeq: 1,
    });
  });

  it("folds the escalated chain with no released draft", () => {
    const episode = replayDecision([
      rec({ type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 1 }, 1),
      rec({ type: "ConfidenceAssessed", confidence: 0.4, threshold: 0.8, tier: "T3" }, 2),
      rec({ type: "Escalated", reason: "below threshold" }, 3),
    ]);

    expect(episode?.status).toBe("escalated");
    expect(episode?.draft).toBeNull();
    expect(episode?.confidence).toBe(0.4);
  });

  it("returns null when the agent never acted on the object", () => {
    const episode = replayDecision([
      rec({ type: "ObjectCreated", id: "c1", objectType: "complaint" }, 1),
      rec({ type: "AttributeSet", key: "text", value: "late" }, 2),
    ]);

    expect(episode).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/organs/cortex/decision.test.ts`
Expected: FAIL — cannot find module `./decision.js`.

- [ ] **Step 3: Implement the fold**

Create `src/organs/cortex/decision.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The decision-trace projection (2B-lite). The agent's decision chain
 * (DecisionProposed → ConfidenceAssessed → Acted | Escalated → OutcomeObserved,
 * ADR-0010) lives on the acted-upon object's event stream, but it is keyed by
 * `correlationId` (the run/episode), not by `objectId`. So it is folded by a
 * *separate* projection — not into ObjectState (ADR-0004: decision/cross-object
 * read models are their own named projections). In-memory only here; the same
 * fold becomes a persisted, cross-object projection when Layer 2 lands —
 * migration-free, since the events are the single source of truth.
 */

import type { RecordedEvent } from "../../mark/index.js";

export interface DecisionEpisode {
  /** The run's correlationId. */
  readonly episode: string;
  readonly status: "proposed" | "acted" | "escalated";
  /** The released draft reply (when acted); null while proposed or escalated. */
  readonly draft: string | null;
  readonly confidence: number | null;
  readonly perceivedObjectId: string;
  readonly perceivedSeq: number;
  readonly outcome?: { readonly wasCorrect: boolean };
}

/**
 * Fold an object's recorded events into its decision episode, or null if the
 * agent never decided on it. Assumes at most one episode per object (true for
 * this slice — one Cortex run per object); when an object can host several runs
 * this generalizes to a Map keyed by `correlationId`.
 */
export function replayDecision(events: readonly RecordedEvent[]): DecisionEpisode | null {
  let episode: DecisionEpisode | null = null;

  for (const recorded of events) {
    const e = recorded.event;
    switch (e.type) {
      case "DecisionProposed":
        episode = {
          episode: recorded.correlationId,
          status: "proposed",
          draft: e.draft,
          confidence: null,
          perceivedObjectId: e.perceivedObjectId,
          perceivedSeq: e.perceivedSeq,
        };
        break;
      case "ConfidenceAssessed":
        if (episode !== null) episode = { ...episode, confidence: e.confidence };
        break;
      case "Acted":
        if (episode !== null) episode = { ...episode, status: "acted" };
        break;
      case "Escalated":
        if (episode !== null) episode = { ...episode, status: "escalated", draft: null };
        break;
      case "OutcomeObserved":
        if (episode !== null) episode = { ...episode, outcome: { wasCorrect: e.wasCorrect } };
        break;
      default:
        break; // domain events (ObjectCreated, AttributeSet, …) are not part of the trace
    }
  }

  return episode === null ? null : Object.freeze(episode);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/organs/cortex/decision.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/organs/cortex/decision.ts src/organs/cortex/decision.test.ts
git commit -m "feat(cortex): replayDecision — the separate decision-trace projection (2B-lite)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: The Cortex orchestrator

`Cortex.run` is the loop: perceive (read) → decide (Decider) → record the chain → gate → act|escalate. Idempotent: an existing episode short-circuits the run (no model re-roll). "Act" records a draft *intent* only — there is no dispatcher (zero outward effect, guardrail 2).

**Files:**
- Create: `src/organs/cortex/cortex.ts`
- Test: `src/organs/cortex/cortex.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/organs/cortex/cortex.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { InMemoryMark, type Mark } from "../../mark/index.js";
import { Cortex } from "./cortex.js";
import { FakeDecider } from "./decider.js";

/** Seed a complaint object directly on the Mark (perception reads it). */
async function seedComplaint(mark: Mark, text: string): Promise<string> {
  const id = "c1";
  await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "test" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "test" } });
  return id;
}

describe("Cortex.run", () => {
  it("acts above the threshold: records the full chain and a draft intent", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "my order never arrived");
    const decider = new FakeDecider({ draft: "We're sorry…", confidence: 0.9 });

    const episode = await new Cortex(mark, decider, { threshold: 0.8 }).run(id);

    expect(episode.status).toBe("acted");
    expect(episode.draft).toBe("We're sorry…");
    expect(episode.confidence).toBe(0.9);
    expect(episode.perceivedSeq).toBe(2);

    const history = await mark.read(id);
    expect(history.map((h) => h.event.type)).toEqual([
      "ObjectCreated",
      "AttributeSet",
      "DecisionProposed",
      "ConfidenceAssessed",
      "Acted",
    ]);

    // The chain shares one correlationId (the episode) — glass-box "why".
    const chain = history.filter((h) =>
      ["DecisionProposed", "ConfidenceAssessed", "Acted"].includes(h.event.type),
    );
    expect(new Set(chain.map((h) => h.correlationId)).size).toBe(1);

    // Acted releases exactly the proposed draft — a recorded intent, nothing dispatched.
    const proposed = history.find((h) => h.event.type === "DecisionProposed");
    const acted = history.find((h) => h.event.type === "Acted");
    expect(proposed).toBeDefined();
    expect(acted?.event).toEqual({ type: "Acted", draftRef: proposed!.eventId });
  });

  it("escalates below the threshold: no draft released", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "unhappy");
    const decider = new FakeDecider({ draft: "draft", confidence: 0.4 });

    const episode = await new Cortex(mark, decider, { threshold: 0.8 }).run(id);

    expect(episode.status).toBe("escalated");
    expect(episode.draft).toBeNull();

    const history = await mark.read(id);
    expect(history.at(-1)?.event.type).toBe("Escalated");
  });

  it("is idempotent: a second run does not re-roll the model or duplicate the chain", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "again");
    const decider = new FakeDecider({ draft: "draft", confidence: 0.9 });
    const cortex = new Cortex(mark, decider, { threshold: 0.8 });

    await cortex.run(id);
    const lengthAfterFirst = (await mark.read(id)).length;
    await cortex.run(id);
    const lengthAfterSecond = (await mark.read(id)).length;

    expect(lengthAfterSecond).toBe(lengthAfterFirst);
    expect(decider.calls).toBe(1);
  });

  it("keeps ObjectState field-clean: version counts decision events, no decision field", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "x");
    await new Cortex(mark, new FakeDecider({ draft: "d", confidence: 0.9 })).run(id);

    const state = await mark.load(id);
    const events = await mark.read(id);
    expect(state?.version).toBe(events.length);
    expect(state && "decision" in state).toBe(false);
  });

  it("refuses to perceive an object that does not exist", async () => {
    const mark = new InMemoryMark();
    const cortex = new Cortex(mark, new FakeDecider({ draft: "d", confidence: 0.9 }));
    await expect(cortex.run("ghost")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/organs/cortex/cortex.test.ts`
Expected: FAIL — cannot find module `./cortex.js`.

- [ ] **Step 3: Implement the orchestrator**

Create `src/organs/cortex/cortex.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Cortex — the agent loop, in its thinnest slice (VISION §4). One run:
 * perceive (read the object) → decide (the Decider) → record the decision chain
 * on the Mark → gate on the action tier → act (record the draft intent) or
 * escalate. No real side effect leaves the system: "act" records an *intent*
 * only; there is no dispatcher (the outbox/relay is a later concern, ADR-0007).
 * The model's output is recorded as DecisionProposed, so a replay or retry
 * never re-rolls it (ADR-0007 record-the-result).
 */

import type { EventMetadata, Mark } from "../../mark/index.js";
import type { Decider } from "./decider.js";
import { gate } from "./gate.js";
import { replayDecision, type DecisionEpisode } from "./decision.js";

/** "Draft a reply to a complaint" is external → tier T3 (ADR-0010). */
const REPLY_TIER = "T3" as const;

export interface CortexOptions {
  /**
   * Confidence floor for a T3 action; below it the run escalates. A placeholder
   * default — empirical calibration is out of scope for this slice (ADR-0010).
   */
  readonly threshold?: number;
  readonly actor?: string;
}

export class Cortex {
  readonly #mark: Mark;
  readonly #decider: Decider;
  readonly #threshold: number;
  readonly #actor: string;

  constructor(mark: Mark, decider: Decider, options: CortexOptions = {}) {
    this.#mark = mark;
    this.#decider = decider;
    this.#threshold = options.threshold ?? 0.8;
    this.#actor = options.actor ?? "cortex";
  }

  /**
   * Run the loop once for a complaint object. Idempotent: if a decision episode
   * already exists, it is returned without calling the model again
   * (memoization-in-the-small — the recorded result is the truth).
   */
  async run(complaintId: string): Promise<DecisionEpisode> {
    const existing = replayDecision(await this.#mark.read(complaintId));
    if (existing !== null) return existing;

    // Perceive.
    const state = await this.#mark.load(complaintId);
    if (state === null) {
      throw new Error(`cannot perceive: object "${complaintId}" does not exist`);
    }
    const text = typeof state.attributes.text === "string" ? state.attributes.text : "";

    // Decide (recorded as an event, so replay never re-rolls it).
    const proposal = await this.#decider.propose({
      objectId: complaintId,
      seq: state.version,
      text,
    });

    const proposed = await this.#mark.append(
      complaintId,
      {
        type: "DecisionProposed",
        draft: proposal.draft,
        perceivedObjectId: complaintId,
        perceivedSeq: state.version,
      },
      { metadata: this.#meta(proposal.confidence), idempotencyKey: `decision:proposed:${complaintId}` },
    );

    const assessed = await this.#mark.append(
      complaintId,
      {
        type: "ConfidenceAssessed",
        confidence: proposal.confidence,
        threshold: this.#threshold,
        tier: REPLY_TIER,
      },
      {
        metadata: this.#meta(proposal.confidence),
        causedBy: { eventId: proposed.eventId, correlationId: proposed.correlationId },
        idempotencyKey: `decision:assessed:${complaintId}`,
      },
    );

    // Gate, then act or escalate.
    const causedBy = { eventId: assessed.eventId, correlationId: assessed.correlationId };
    if (gate(REPLY_TIER, proposal.confidence, this.#threshold) === "act") {
      await this.#mark.append(
        complaintId,
        { type: "Acted", draftRef: proposed.eventId },
        { metadata: this.#meta(proposal.confidence), causedBy, idempotencyKey: `decision:acted:${complaintId}` },
      );
    } else {
      await this.#mark.append(
        complaintId,
        {
          type: "Escalated",
          reason: `confidence ${proposal.confidence} below threshold ${this.#threshold}`,
        },
        { metadata: this.#meta(proposal.confidence), causedBy, idempotencyKey: `decision:escalated:${complaintId}` },
      );
    }

    const episode = replayDecision(await this.#mark.read(complaintId));
    if (episode === null) {
      throw new Error(`decision episode missing after a successful run on "${complaintId}"`);
    }
    return episode;
  }

  /** Glass-box envelope: stamp the actor and the decision's confidence (§3.2). */
  #meta(confidence: number): EventMetadata {
    return { actor: this.#actor, confidence };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/organs/cortex/cortex.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/organs/cortex/cortex.ts src/organs/cortex/cortex.test.ts
git commit -m "feat(cortex): the agent loop — perceive, decide, gate, record (ADR-0007/0010)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: The 2B-lite merge — readObjectWithDecision

`ObjectState` stays field-clean; a consumer wanting "is a draft pending / escalated?" reads both projections and combines them here, rather than loading the decision facet into the core projection.

**Files:**
- Create: `src/organs/cortex/read.ts`
- Test: `src/organs/cortex/read.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/organs/cortex/read.test.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { InMemoryMark } from "../../mark/index.js";
import { Cortex } from "./cortex.js";
import { FakeDecider } from "./decider.js";
import { readObjectWithDecision } from "./read.js";

describe("readObjectWithDecision", () => {
  it("merges field-clean state with the decision episode", async () => {
    const mark = new InMemoryMark();
    const id = "c1";
    await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "test" } });
    await mark.append(id, { type: "AttributeSet", key: "text", value: "late" }, { metadata: { actor: "test" } });
    await new Cortex(mark, new FakeDecider({ draft: "Sorry", confidence: 0.9 })).run(id);

    const merged = await readObjectWithDecision(mark, id);

    expect(merged?.state.attributes).toEqual({ text: "late" });
    expect(merged?.state && "decision" in merged.state).toBe(false);
    expect(merged?.decision?.status).toBe("acted");
    expect(merged?.decision?.draft).toBe("Sorry");
  });

  it("returns null for an unknown object", async () => {
    expect(await readObjectWithDecision(new InMemoryMark(), "nope")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/organs/cortex/read.test.ts`
Expected: FAIL — cannot find module `./read.js`.

- [ ] **Step 3: Implement the merge**

Create `src/organs/cortex/read.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Reading an object *with* its decision trace — the 2B-lite merge. ObjectState
 * stays field-clean; a consumer that wants "is a draft pending / escalated?"
 * reads both projections (the domain fold via `load`, the decision fold via
 * `replayDecision`) and combines them here, rather than loading the decision
 * facet into the core projection (ADR-0004).
 */

import type { Mark, ObjectState } from "../../mark/index.js";
import { replayDecision, type DecisionEpisode } from "./decision.js";

export interface ObjectWithDecision {
  readonly state: ObjectState;
  readonly decision: DecisionEpisode | null;
}

export async function readObjectWithDecision(
  mark: Mark,
  id: string,
): Promise<ObjectWithDecision | null> {
  const state = await mark.load(id);
  if (state === null) return null;
  const decision = replayDecision(await mark.read(id));
  return { state, decision };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/organs/cortex/read.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/organs/cortex/read.ts src/organs/cortex/read.test.ts
git commit -m "feat(cortex): readObjectWithDecision — the 2B-lite merge of both projections

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: PostgreSQL parity for the decision chain

The Postgres adapter parses every stored event at the read boundary (`parseMarkEvent` + upcasting). This proves the new event types round-trip there too, that `load == replay(read)` still holds, and that the glass-box `confidence` survives — adapter parity, the kernel's standard.

**Files:**
- Modify: `src/mark/postgres.test.ts`

- [ ] **Step 1: Bring up Postgres and export the URL**

Run:
```bash
npm run db:up
export MARROW_TEST_DATABASE_URL="postgres://postgres:marrow@localhost:55432/marrow"
```
Expected: a `marrow-pg` container is running.

- [ ] **Step 2: Write the failing test**

Add this test inside the existing `describe.skipIf(!url)("PostgresMark", …)` block in `src/mark/postgres.test.ts` (e.g. after the lineage test):

```typescript
  it("round-trips the agent decision chain and load equals replay(read)", async () => {
    await mark.append("c1", { type: "ObjectCreated", id: "c1", objectType: "complaint" });
    await mark.append("c1", { type: "AttributeSet", key: "text", value: "late delivery" });
    const proposed = await mark.append(
      "c1",
      { type: "DecisionProposed", draft: "We're sorry…", perceivedObjectId: "c1", perceivedSeq: 2 },
      { metadata: { actor: "cortex", confidence: 0.9 } },
    );
    await mark.append("c1", {
      type: "ConfidenceAssessed",
      confidence: 0.9,
      threshold: 0.8,
      tier: "T3",
    });
    await mark.append("c1", { type: "Acted", draftRef: proposed.eventId });

    const read = await mark.read("c1");
    expect(read.map((e) => e.event.type)).toEqual([
      "ObjectCreated",
      "AttributeSet",
      "DecisionProposed",
      "ConfidenceAssessed",
      "Acted",
    ]);

    // ObjectState stays field-clean; version counts every event in the stream.
    const loaded = await mark.load("c1");
    expect(loaded).toEqual(replay(read.map((r) => r.event)));
    expect(loaded?.version).toBe(5);
    expect(loaded?.attributes).toEqual({ text: "late delivery" });

    // Glass-box confidence survives the round-trip.
    const proposedRead = read.find((e) => e.event.type === "DecisionProposed");
    expect(proposedRead?.metadata.confidence).toBe(0.9);
  });
```

- [ ] **Step 3: Run it to verify it passes**

Run: `npx vitest run src/mark/postgres.test.ts`
Expected: PASS — the decision events round-trip through the parser and the fold.

(If it instead errors on parsing a decision event, the zod schema in Task 1/Step 4 is missing that variant — fix `event-schema.ts`, do not weaken the parser.)

- [ ] **Step 4: Run the full suite with Postgres active**

Run: `npm test`
Expected: PASS — both adapters, including the new parity test.

- [ ] **Step 5: Commit**

```bash
git add src/mark/postgres.test.ts
git commit -m "test(mark): Postgres parity for the decision chain; load == replay(read) holds

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: The organ barrel and a runnable demo

Make the slice visible and reproducible (CLAUDE.md: "demos make it visible"), with no API key — the `FakeDecider` drives it.

**Files:**
- Create: `src/organs/cortex/index.ts`
- Create: `examples/cortex-demo.ts`
- Modify: `package.json`

- [ ] **Step 1: Create the organ barrel**

Create `src/organs/cortex/index.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Cortex — MARROW's agent loop (VISION §4). Public surface: the orchestrator,
 * the model-agnostic Decider seam, the autonomy gate, and the decision-trace
 * projection. This slice perceives, decides, gates, and records *why* — no real
 * side effect leaves the system.
 */

export { Cortex, type CortexOptions } from "./cortex.js";
export { type Decider, type DecisionContext, type Proposal, FakeDecider } from "./decider.js";
export { gate, type GateOutcome } from "./gate.js";
export { replayDecision, type DecisionEpisode } from "./decision.js";
export { readObjectWithDecision, type ObjectWithDecision } from "./read.js";
```

- [ ] **Step 2: Write the demo**

Create `examples/cortex-demo.ts`:

```typescript
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Cortex slice, made visible (ADR-0006 / VISION §4). Two complaints: one the
 * agent answers confidently (acts — a draft intent is recorded), one it is
 * unsure about (escalates — nothing released). Runs on an in-memory Mark with a
 * scripted decider: no API key, fully reproducible. The history printed at the
 * end is the glass-box "why" — the whole decision chain, recorded.
 */

import { InMemoryMark } from "../src/mark/index.js";
import { Cortex, FakeDecider, readObjectWithDecision } from "../src/organs/cortex/index.js";

async function seedComplaint(mark: InMemoryMark, text: string): Promise<string> {
  const id = `complaint-${text.length}-${text.charCodeAt(0)}`;
  await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "demo" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "demo" } });
  return id;
}

async function main(): Promise<void> {
  const mark = new InMemoryMark();

  // 1) A confident answer → the agent acts (records a draft intent).
  const confident = await seedComplaint(mark, "My order never arrived and I want a status update.");
  await new Cortex(mark, new FakeDecider({
    draft: "We're sorry for the delay — your order ships tomorrow with tracking.",
    confidence: 0.92,
  }), { actor: "cortex:demo" }).run(confident);

  // 2) A murkier complaint → low confidence → the agent escalates.
  const murky = await seedComplaint(mark, "This is the third time and I'm considering legal action.");
  await new Cortex(mark, new FakeDecider({
    draft: "We understand your frustration…",
    confidence: 0.45,
  }), { actor: "cortex:demo" }).run(murky);

  for (const id of [confident, murky]) {
    const merged = await readObjectWithDecision(mark, id);
    console.log(`\n=== ${id} ===`);
    console.log("decision:", merged?.decision);
    console.log("glass-box chain:");
    for (const e of await mark.read(id)) {
      console.log(`  #${e.seq} ${e.event.type}  (actor: ${e.metadata.actor}, corr: ${e.correlationId.slice(0, 8)})`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Add the demo script**

In `package.json`, add to `"scripts"` (after the `"mcp:demo"` line):

```json
    "cortex:demo": "tsx examples/cortex-demo.ts",
```

- [ ] **Step 4: Run the demo**

Run: `npm run cortex:demo`
Expected: two blocks printed — the first object's `decision.status` is `"acted"` with the draft; the second is `"escalated"` with `draft: null`; each prints its full event chain (ObjectCreated → AttributeSet → DecisionProposed → ConfidenceAssessed → Acted|Escalated) sharing one correlation id.

- [ ] **Step 5: Typecheck and full suite**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/organs/cortex/index.ts examples/cortex-demo.ts package.json
git commit -m "feat(cortex): organ barrel + runnable no-API-key demo (acted + escalated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Record the slice on the capability map

The capability map is "where we are" (CLAUDE.md). Record the Cortex slice as built and leave a findings stub to fill from real use — the slice's whole purpose.

**Files:**
- Modify: `docs/mark-capability-map.md`

- [ ] **Step 1: Update the Status section**

In `docs/mark-capability-map.md`, under `## Status`, add a bullet after the "Vertical slice — done" bullet:

```markdown
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
```

- [ ] **Step 2: Add a findings stub**

Add a new section at the end of the file (after "Findings from dogfooding (the slice)"):

```markdown
## Findings from the Cortex slice

What the first acting agent teaches (fill from real runs — the slice's purpose):

- **Within-object decision episodes thread cleanly.** A Cortex run's chain shares
  one `correlationId`; unlike the MCP slice (each call its own root), the agent's
  own action has a real "why" to thread. Cross-object cases remain open (decide
  with more workflow data points, per the MCP-slice finding).
- _(to record after real use:)_ Is the `Decider` seam the right shape when a real
  model adapter lands? Is recorded `confidence` (placeholder) enough envelope for
  audit, or is `ConfidenceAssessed` carrying too little? Does the version-only
  pass-through (decision events bump `ObjectState.version`) confuse consumers, or
  is it honest? When does 2B-lite → full 2B pull (the calibration-curve query)?
```

- [ ] **Step 3: Commit**

```bash
git add docs/mark-capability-map.md
git commit -m "docs: record the Cortex slice on the capability map + findings stub

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Final verification and PR

- [ ] **Step 1: Full green suite on both adapters**

Run (with `MARROW_TEST_DATABASE_URL` still exported and `marrow-pg` up):
```bash
npm run typecheck && npm test
```
Expected: PASS — all in-memory and Postgres tests, including the new gate, decider, decision, cortex, read, and parity tests.

- [ ] **Step 2: Re-run the demo as a final smoke test**

Run: `npm run cortex:demo`
Expected: the acted + escalated arc prints as in Task 8.

- [ ] **Step 3: Open the PR**

```bash
git push -u origin feat/cortex-slice
gh pr create --base main --title "feat(cortex): thin vertical slice of the agent loop" --body "$(cat <<'EOF'
The second reality-check organ after the MCP slice (ADR-0006): MARROW's own agent
perceives a complaint, decides (draft + confidence), gates on action tier T3
(ADR-0010), and records the full decision chain on the Mark.

- New decision-chain events fold as version-only pass-through; **ObjectState stays
  field-clean**. The decision trace is a **separate projection** (`replayDecision`,
  keyed by correlationId — 2B-lite, the second read model after `list_objects`).
- Model-agnostic `Decider` seam (fake-only here; any provider attaches later).
- "Act" records a draft **intent** — no dispatcher, zero outward effect.
- Idempotent / replay-safe (record-the-result; idempotency keys).
- Adapter parity holds: `load == replay(read)` on both, including the new events.

Spec: `docs/superpowers/specs/2026-06-15-cortex-slice-design.md`.
Plan: `docs/superpowers/plans/2026-06-15-cortex-slice.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Tear down the test DB (optional)**

Run: `npm run db:down`

---

## Self-review notes (for the implementer)

- **Independent review pass after the code is green.** Per CLAUDE.md ("Review, then harden"), run a code review + a security pass before merge; fix findings at the right layer.
- **Do not weaken the parser** if a decision event fails to round-trip in Task 7 — the fix is always a missing/incorrect zod variant in `event-schema.ts`, never a laxer `parseMarkEvent`.
- **The thin cuts are deliberate** (real LLM adapter, generic step journal, real outbox/relay, calibration, cross-object case, Layer-2 framework). If a task tempts you to build one, stop — it is out of scope by design (spec §7).
