# Lens 0 — the Trace-View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Lens 0 — a pure, read-only projection (`replayTrace` → a causal forest) plus an episode summary and a text renderer that make the Cortex's decision chain legible (gate verdict, draft, perceived context, outcome) from events alone.

**Architecture:** A new organ `src/organs/lens/`. `trace.ts` folds `RecordedEvent[]` into a `TraceForest` keyed by `causationId` (objectId-agnostic). `episode.ts` derives one `EpisodeSummary` per decision `correlationId`, reusing `cortex/replayDecision` and supplementing the audit fields it drops. `render.ts` turns the structure into plain text. Everything is a pure function of the event array — no persistence, no second source of truth (on-thesis with VISION §3.1, ADR-0009/0004). See the spec: `docs/superpowers/specs/2026-06-15-lens-0-trace-view-design.md`.

**Tech Stack:** TypeScript (ESM, Node ≥22), Vitest, `tsx` for the demo. No new runtime dependencies.

---

## File Structure

- Create `src/organs/lens/trace.ts` — `TraceNode`, `TraceForest`, `summaryOf`, `replayTrace`.
- Create `src/organs/lens/episode.ts` — `EpisodeSummary`, `summarizeEpisodes` (imports `replayDecision` from `../cortex/index.js`).
- Create `src/organs/lens/render.ts` — `renderTrace`.
- Create `src/organs/lens/index.ts` — public surface.
- Create tests `src/organs/lens/trace.test.ts`, `episode.test.ts`, `render.test.ts`.
- Create `examples/lens-trace.ts` — the `npm run lens` demo.
- Modify `package.json` — add the `lens` script.
- Modify `docs/mark-capability-map.md` — record Lens 0 under Status / Findings.

Every new source file starts with:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks
```

A shared test fixture helper (copy into each test file that needs hand-built events):
```ts
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";

function rec(o: Partial<RecordedEvent> & { eventId: string; event: MarkEvent }): RecordedEvent {
  return {
    eventId: o.eventId,
    correlationId: o.correlationId ?? o.eventId,
    causationId: o.causationId ?? null,
    globalSeq: o.globalSeq ?? 0,
    objectId: o.objectId ?? "obj",
    seq: o.seq ?? 1,
    schemaVersion: o.schemaVersion ?? 1,
    event: o.event,
    metadata: o.metadata ?? { actor: "test" },
    occurredAt: o.occurredAt ?? "2026-06-15T00:00:00.000Z",
    recordedAt: o.recordedAt ?? "2026-06-15T00:00:00.000Z",
  };
}
```

---

## Task 1: `summaryOf` — an exhaustive one-line essence per event

**Files:**
- Create: `src/organs/lens/trace.ts`
- Test: `src/organs/lens/trace.test.ts`

- [ ] **Step 1: Write the failing test**

In `src/organs/lens/trace.test.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import { summaryOf } from "./trace.js";

describe("summaryOf", () => {
  it("renders a one-line essence per event type", () => {
    expect(summaryOf({ type: "ObjectCreated", id: "x", objectType: "complaint" })).toContain("complaint");
    expect(summaryOf({ type: "AttributeSet", key: "text", value: "hi" })).toContain("text");
    expect(summaryOf({ type: "StateChanged", state: "open" })).toContain("open");
    expect(summaryOf({ type: "NoteAdded", text: "note" })).toContain("note");
    expect(
      summaryOf({ type: "DecisionProposed", draft: "Sorry!", perceivedObjectId: "c1", perceivedSeq: 2 }),
    ).toContain("Sorry!");
    expect(summaryOf({ type: "ConfidenceAssessed", confidence: 0.72, threshold: 0.8, tier: "T3" })).toContain("0.72");
    expect(summaryOf({ type: "Acted", draftRef: "abcdef123456" })).toContain("abcdef12");
    expect(summaryOf({ type: "Escalated", reason: "too low" })).toContain("too low");
    expect(summaryOf({ type: "OutcomeObserved", wasCorrect: true, evidence: "human ok" })).toContain("human ok");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/organs/lens/trace.test.ts`
Expected: FAIL — cannot find module `./trace.js` / `summaryOf` not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/organs/lens/trace.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 — the trace projection. Folds an event stream into a causal forest
 * (keyed by causationId, objectId-agnostic) plus a one-line summary per event.
 * A pure function of the events: no persistence, no second source of truth —
 * the trace IS the events (VISION §3.1, ADR-0009/0004).
 */

import type {
  ActionTier,
  EventMetadata,
  MarkEvent,
  MarkEventType,
  RecordedEvent,
} from "../../mark/index.js";

const clip = (s: string, n = 60): string => (s.length > n ? `${s.slice(0, n)}…` : s);
const valueOf = (v: unknown): string => clip(JSON.stringify(v) ?? "null", 40);

/** A one-line, human-readable essence of an event. Exhaustive over the union:
 *  adding a MarkEvent variant is a compile error here (project hard rule). */
export function summaryOf(event: MarkEvent): string {
  switch (event.type) {
    case "ObjectCreated":
      return `created ${event.objectType}`;
    case "AttributeSet":
      return `${event.key} = ${valueOf(event.value)}`;
    case "StateChanged":
      return `state → ${event.state}`;
    case "NoteAdded":
      return `note: ${clip(event.text)}`;
    case "DecisionProposed":
      return `proposed: "${clip(event.draft)}" (perceived ${event.perceivedObjectId} @seq ${event.perceivedSeq})`;
    case "ConfidenceAssessed":
      return `confidence ${event.confidence} vs threshold ${event.threshold} (${event.tier})`;
    case "Acted":
      return `acted → released draft ${event.draftRef.slice(0, 8)}`;
    case "Escalated":
      return `escalated: ${clip(event.reason)}`;
    case "OutcomeObserved":
      return `outcome: ${event.wasCorrect ? "correct" : "incorrect"}${
        event.evidence ? ` — ${clip(event.evidence)}` : ""
      }`;
    default: {
      const _exhaustive: never = event;
      throw new Error(`unhandled event type: ${String(_exhaustive)}`);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/organs/lens/trace.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/organs/lens/trace.ts src/organs/lens/trace.test.ts
git commit -m "feat(lens): exhaustive summaryOf for the trace view"
```

---

## Task 2: `replayTrace` — fold events into a causal forest

**Files:**
- Modify: `src/organs/lens/trace.ts`
- Test: `src/organs/lens/trace.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/organs/lens/trace.test.ts` (add `replayTrace`, `type TraceForest` to the import from `./trace.js`, and add the `rec` helper + the `MarkEvent`/`RecordedEvent` type import shown in the File Structure section):
```ts
import { replayTrace } from "./trace.js";

describe("replayTrace", () => {
  it("threads a linear decision chain into one branch", () => {
    const events = [
      rec({ eventId: "p", globalSeq: 1, event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
      rec({ eventId: "a", globalSeq: 2, correlationId: "p", causationId: "p", event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "x", globalSeq: 3, correlationId: "p", causationId: "a", event: { type: "Acted", draftRef: "p" } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0].eventId).toBe("p");
    expect(forest[0].children.map((c) => c.eventId)).toEqual(["a"]);
    expect(forest[0].children[0].children.map((c) => c.eventId)).toEqual(["x"]);
  });

  it("builds a shallow star for ObjectCreated → N attributes", () => {
    const events = [
      rec({ eventId: "o", globalSeq: 1, event: { type: "ObjectCreated", id: "obj", objectType: "complaint" } }),
      rec({ eventId: "k1", globalSeq: 2, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "text", value: "hi" } }),
      rec({ eventId: "k2", globalSeq: 3, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "lang", value: "de" } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0].children.map((c) => c.eventId)).toEqual(["k1", "k2"]);
  });

  it("yields a forest of roots for a creation star + a separate decision chain", () => {
    const events = [
      rec({ eventId: "o", globalSeq: 1, event: { type: "ObjectCreated", id: "obj", objectType: "complaint" } }),
      rec({ eventId: "k1", globalSeq: 2, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "text", value: "hi" } }),
      rec({ eventId: "p", globalSeq: 3, event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
    ];
    const forest = replayTrace(events);
    expect(forest.map((r) => r.eventId)).toEqual(["o", "p"]);
  });

  it("is a function of the event array alone (shuffle → identical forest)", () => {
    const events = [
      rec({ eventId: "p", globalSeq: 1, event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
      rec({ eventId: "a", globalSeq: 2, correlationId: "p", causationId: "p", event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "x", globalSeq: 3, correlationId: "p", causationId: "a", event: { type: "Acted", draftRef: "p" } }),
    ];
    const inOrder = JSON.stringify(replayTrace(events));
    const shuffled = JSON.stringify(replayTrace([events[2], events[0], events[1]]));
    expect(shuffled).toBe(inOrder);
  });

  it("merges a cross-object causal edge into one tree (objectId-agnostic)", () => {
    const events = [
      rec({ eventId: "src", globalSeq: 1, objectId: "A", event: { type: "NoteAdded", text: "trigger" } }),
      rec({ eventId: "dec", globalSeq: 2, objectId: "B", correlationId: "src", causationId: "src", event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "A", perceivedSeq: 1 } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0].children.map((c) => c.eventId)).toEqual(["dec"]);
  });

  it("flags a dangling causationId as an externalCause root (forward-looking)", () => {
    const events = [
      rec({ eventId: "dec", globalSeq: 2, correlationId: "missing", causationId: "missing", event: { type: "DecisionProposed", draft: "d", perceivedObjectId: "obj", perceivedSeq: 1 } }),
    ];
    const forest = replayTrace(events);
    expect(forest).toHaveLength(1);
    expect(forest[0].externalCause).toBe("missing");
  });

  it("throws on a duplicate eventId (corruption signal)", () => {
    const dup = [
      rec({ eventId: "d", globalSeq: 1, event: { type: "NoteAdded", text: "a" } }),
      rec({ eventId: "d", globalSeq: 2, event: { type: "NoteAdded", text: "b" } }),
    ];
    expect(() => replayTrace(dup)).toThrow(/duplicate eventId/);
  });

  it("surfaces confidence and tier on a ConfidenceAssessed node, undefined elsewhere", () => {
    const events = [
      rec({ eventId: "a", globalSeq: 1, event: { type: "ConfidenceAssessed", confidence: 0.72, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "n", globalSeq: 2, event: { type: "NoteAdded", text: "x" } }),
    ];
    const [assessed, note] = replayTrace(events);
    expect(assessed.confidence).toBe(0.72);
    expect(assessed.tier).toBe("T3");
    expect(note.confidence).toBeUndefined();
    expect(note.tier).toBeUndefined();
  });

  it("handles degenerate inputs", () => {
    expect(replayTrace([])).toEqual([]);
    expect(replayTrace([rec({ eventId: "s", event: { type: "NoteAdded", text: "x" } })])).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/organs/lens/trace.test.ts`
Expected: FAIL — `replayTrace` not exported.

- [ ] **Step 3: Write the implementation**

Append to `src/organs/lens/trace.ts`:
```ts
export interface TraceNode {
  readonly eventId: string;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly type: MarkEventType;
  readonly seq: number;
  readonly globalSeq: number;
  readonly objectId: string;
  readonly occurredAt: string;
  readonly actor: string;
  readonly confidence?: number;
  readonly tier?: ActionTier;
  readonly externalCause?: string;
  readonly summary: string;
  readonly event: MarkEvent;
  readonly metadata: EventMetadata;
  readonly children: readonly TraceNode[];
}

export type TraceForest = readonly TraceNode[];

/** Mutable builder mirror of TraceNode (children grow during the fold). */
type Building = Omit<TraceNode, "children" | "externalCause"> & {
  children: Building[];
  externalCause?: string;
};

/** Total order on a single Mark: globalSeq is unique; eventId is tiebreak
 *  insurance against accidentally-merged streams. */
const byOrder = (a: { globalSeq: number; eventId: string }, b: { globalSeq: number; eventId: string }): number =>
  a.globalSeq - b.globalSeq || (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0);

function toNode(r: RecordedEvent): Building {
  const e = r.event;
  const node: Building = {
    eventId: r.eventId,
    correlationId: r.correlationId,
    causationId: r.causationId,
    type: e.type,
    seq: r.seq,
    globalSeq: r.globalSeq,
    objectId: r.objectId,
    occurredAt: r.occurredAt,
    actor: r.metadata.actor,
    summary: summaryOf(e),
    event: e,
    metadata: r.metadata,
    children: [],
  };
  const confidence = e.type === "ConfidenceAssessed" ? e.confidence : r.metadata.confidence;
  if (confidence !== undefined) (node as { confidence?: number }).confidence = confidence;
  if (e.type === "ConfidenceAssessed") (node as { tier?: ActionTier }).tier = e.tier;
  return node;
}

/**
 * Fold an event stream into a causal forest. Roots are events with no cause, or
 * with a `causationId` that dangles outside the set (flagged `externalCause` —
 * forward-looking; today's data never produces it). Pure and order-independent:
 * shuffle the input, get an identical forest.
 */
export function replayTrace(events: readonly RecordedEvent[]): TraceForest {
  const sorted = [...events].sort(byOrder);
  const map = new Map<string, Building>();
  for (const r of sorted) {
    if (map.has(r.eventId)) {
      throw new Error(`duplicate eventId "${r.eventId}" — corrupt event set`);
    }
    map.set(r.eventId, toNode(r));
  }

  const roots: Building[] = [];
  for (const r of sorted) {
    const node = map.get(r.eventId) as Building;
    if (r.causationId === null) {
      roots.push(node);
      continue;
    }
    const parent = map.get(r.causationId);
    if (parent === undefined) {
      node.externalCause = r.causationId;
      roots.push(node);
    } else {
      parent.children.push(node);
    }
  }

  for (const node of map.values()) node.children.sort(byOrder);
  roots.sort(byOrder);
  return roots as unknown as TraceForest;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/organs/lens/trace.test.ts`
Expected: PASS (all `replayTrace` tests + the `summaryOf` test).

- [ ] **Step 5: Commit**

```bash
git add src/organs/lens/trace.ts src/organs/lens/trace.test.ts
git commit -m "feat(lens): replayTrace folds events into a causal forest"
```

---

## Task 3: `summarizeEpisodes` — one audit-rich summary per decision correlation

**Files:**
- Create: `src/organs/lens/episode.ts`
- Test: `src/organs/lens/episode.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/organs/lens/episode.test.ts` (include the `rec` helper + type imports from the File Structure section):
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { summarizeEpisodes } from "./episode.js";

// (paste the `rec` helper here)

const actedChain = (corr: string, base: number): RecordedEvent[] => [
  rec({ eventId: `${corr}p`, globalSeq: base + 1, correlationId: corr, event: { type: "DecisionProposed", draft: "Sorry!", perceivedObjectId: "c1", perceivedSeq: 2 } }),
  rec({ eventId: `${corr}a`, globalSeq: base + 2, correlationId: corr, causationId: `${corr}p`, event: { type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" } }),
  rec({ eventId: `${corr}x`, globalSeq: base + 3, correlationId: corr, causationId: `${corr}a`, event: { type: "Acted", draftRef: `${corr}p` } }),
];

describe("summarizeEpisodes", () => {
  it("summarizes an acted episode, restoring threshold/tier/draft/perceived", () => {
    const [s] = summarizeEpisodes(actedChain("E", 0));
    expect(s).toMatchObject({
      correlationId: "E",
      status: "acted",
      gateVerdict: "act",
      confidence: 0.9,
      threshold: 0.8,
      tier: "T3",
      draft: "Sorry!",
      perceivedObjectId: "c1",
      perceivedSeq: 2,
    });
    expect(s.outcome).toBeUndefined();
  });

  it("keeps the proposed draft even when the episode escalated", () => {
    const events: RecordedEvent[] = [
      rec({ eventId: "Ep", globalSeq: 1, correlationId: "E", event: { type: "DecisionProposed", draft: "Maybe?", perceivedObjectId: "c1", perceivedSeq: 2 } }),
      rec({ eventId: "Ea", globalSeq: 2, correlationId: "E", causationId: "Ep", event: { type: "ConfidenceAssessed", confidence: 0.4, threshold: 0.8, tier: "T3" } }),
      rec({ eventId: "Ex", globalSeq: 3, correlationId: "E", causationId: "Ea", event: { type: "Escalated", reason: "too low" } }),
    ];
    const [s] = summarizeEpisodes(events);
    expect(s.status).toBe("escalated");
    expect(s.gateVerdict).toBe("escalate");
    expect(s.draft).toBe("Maybe?");
  });

  it("restores outcome with evidence when present", () => {
    const events = [
      ...actedChain("E", 0),
      rec({ eventId: "Eo", globalSeq: 5, correlationId: "E", causationId: "Ex", event: { type: "OutcomeObserved", wasCorrect: true, evidence: "human approved" } }),
    ];
    const [s] = summarizeEpisodes(events);
    expect(s.outcome).toEqual({ wasCorrect: true, evidence: "human approved" });
  });

  it("returns one summary per episode on a multi-episode object (no last-wins collapse)", () => {
    const events = [...actedChain("E1", 0), ...actedChain("E2", 10)];
    const summaries = summarizeEpisodes(events);
    expect(summaries.map((s) => s.correlationId).sort()).toEqual(["E1", "E2"]);
  });

  it("ignores correlations without a decision, and empty input", () => {
    const domain = [rec({ eventId: "o", event: { type: "ObjectCreated", id: "obj", objectType: "complaint" } })];
    expect(summarizeEpisodes(domain)).toEqual([]);
    expect(summarizeEpisodes([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/organs/lens/episode.test.ts`
Expected: FAIL — `./episode.js` / `summarizeEpisodes` missing.

- [ ] **Step 3: Write the implementation**

In `src/organs/lens/episode.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Per-episode audit summary. Groups events by correlationId; for each
 * correlation that holds a decision, it reuses the canonical `replayDecision`
 * fold (one episode per slice — its assumption holds here) for status +
 * confidence, and restores the audit fields replayDecision deliberately drops:
 * threshold/tier, the proposed draft, the perceived context, and the outcome's
 * evidence. Pure: a function of the events alone.
 */

import type { ActionTier, RecordedEvent } from "../../mark/index.js";
import { replayDecision } from "../cortex/index.js";

export interface EpisodeSummary {
  readonly correlationId: string;
  readonly status: "proposed" | "acted" | "escalated";
  readonly gateVerdict: "act" | "escalate" | null;
  readonly confidence: number | null;
  readonly threshold: number | null;
  readonly tier: ActionTier | null;
  readonly draft: string | null;
  readonly perceivedObjectId: string | null;
  readonly perceivedSeq: number | null;
  readonly outcome?: { readonly wasCorrect: boolean; readonly evidence: string | null };
}

export function summarizeEpisodes(events: readonly RecordedEvent[]): readonly EpisodeSummary[] {
  const sorted = [...events].sort((a, b) => a.globalSeq - b.globalSeq);
  const byCorrelation = new Map<string, RecordedEvent[]>();
  for (const r of sorted) {
    const list = byCorrelation.get(r.correlationId) ?? [];
    list.push(r);
    byCorrelation.set(r.correlationId, list);
  }

  const summaries: EpisodeSummary[] = [];
  for (const [correlationId, slice] of byCorrelation) {
    if (!slice.some((r) => r.event.type === "DecisionProposed")) continue;
    const episode = replayDecision(slice);
    if (episode === null) continue;

    const proposed = slice.find((r) => r.event.type === "DecisionProposed");
    const assessed = slice.find((r) => r.event.type === "ConfidenceAssessed");
    const observed = slice.find((r) => r.event.type === "OutcomeObserved");

    const draft = proposed?.event.type === "DecisionProposed" ? proposed.event.draft : null;
    const perceivedObjectId = proposed?.event.type === "DecisionProposed" ? proposed.event.perceivedObjectId : null;
    const perceivedSeq = proposed?.event.type === "DecisionProposed" ? proposed.event.perceivedSeq : null;
    const threshold = assessed?.event.type === "ConfidenceAssessed" ? assessed.event.threshold : null;
    const tier = assessed?.event.type === "ConfidenceAssessed" ? assessed.event.tier : null;
    const gateVerdict = episode.status === "acted" ? "act" : episode.status === "escalated" ? "escalate" : null;

    const base: EpisodeSummary = {
      correlationId,
      status: episode.status,
      gateVerdict,
      confidence: episode.confidence,
      threshold,
      tier,
      draft,
      perceivedObjectId,
      perceivedSeq,
    };
    summaries.push(
      observed?.event.type === "OutcomeObserved"
        ? { ...base, outcome: { wasCorrect: observed.event.wasCorrect, evidence: observed.event.evidence } }
        : base,
    );
  }
  return summaries;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/organs/lens/episode.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/organs/lens/episode.ts src/organs/lens/episode.test.ts
git commit -m "feat(lens): summarizeEpisodes — audit-rich per-correlation summary"
```

---

## Task 4: `renderTrace` — legible plain-text trace

**Files:**
- Create: `src/organs/lens/render.ts`
- Test: `src/organs/lens/render.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/organs/lens/render.test.ts` (include the `rec` helper + type imports):
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, expect, it } from "vitest";
import type { MarkEvent, RecordedEvent } from "../../mark/index.js";
import { replayTrace } from "./trace.js";
import { summarizeEpisodes } from "./episode.js";
import { renderTrace } from "./render.js";

// (paste the `rec` helper here)

const fullComplaint = (status: "acted" | "escalated"): RecordedEvent[] => {
  const conf = status === "acted" ? 0.9 : 0.4;
  const last: MarkEvent = status === "acted" ? { type: "Acted", draftRef: "p" } : { type: "Escalated", reason: "confidence 0.4 below threshold 0.8" };
  return [
    rec({ eventId: "o", globalSeq: 1, event: { type: "ObjectCreated", id: "c1", objectType: "complaint" } }),
    rec({ eventId: "k", globalSeq: 2, correlationId: "o", causationId: "o", event: { type: "AttributeSet", key: "text", value: "order never arrived" } }),
    rec({ eventId: "p", globalSeq: 3, correlationId: "p", event: { type: "DecisionProposed", draft: "We're sorry for the delay.", perceivedObjectId: "c1", perceivedSeq: 2 } }),
    rec({ eventId: "a", globalSeq: 4, correlationId: "p", causationId: "p", event: { type: "ConfidenceAssessed", confidence: conf, threshold: 0.8, tier: "T3" } }),
    rec({ eventId: "x", globalSeq: 5, correlationId: "p", causationId: "a", event: last }),
  ];
};

const render = (events: RecordedEvent[]): string => renderTrace(replayTrace(events), summarizeEpisodes(events));

describe("renderTrace", () => {
  it("shows the gate verdict, draft, perceived context and domain context for an acted episode", () => {
    const out = render(fullComplaint("acted"));
    expect(out).toContain("ACTED");
    expect(out).toContain("0.9");
    expect(out).toContain("0.8");
    expect(out).toContain("T3");
    expect(out).toContain("We're sorry for the delay.");
    expect(out).toContain("perceived c1");
    expect(out).toContain("ObjectCreated"); // domain context shown, not filtered
    expect(out).toContain("no second source of truth");
  });

  it("shows the escalation reason verbatim for an escalated episode", () => {
    const out = render(fullComplaint("escalated"));
    expect(out).toContain("ESCALATED");
    expect(out).toContain("confidence 0.4 below threshold 0.8");
  });

  it("renders the outcome with evidence when present", () => {
    const events = [
      ...fullComplaint("acted"),
      rec({ eventId: "ob", globalSeq: 6, correlationId: "p", causationId: "x", event: { type: "OutcomeObserved", wasCorrect: true, evidence: "human approved" } }),
    ];
    expect(render(events)).toContain("human approved");
  });

  it("no-ops cleanly on an empty forest", () => {
    const out = renderTrace([], []);
    expect(out).toContain("reconstructed from 0 event(s)");
    expect(out).not.toContain("▸ episode");
  });

  it("terminates on a cyclic fixture instead of stack-overflowing", () => {
    // Hand-built corruption: a ⇄ b. Build nodes directly to bypass replayTrace's acyclic guarantee.
    const a = { eventId: "a", correlationId: "a", causationId: "b", type: "NoteAdded" as const, seq: 1, globalSeq: 1, objectId: "o", occurredAt: "t", actor: "t", summary: "a", event: { type: "NoteAdded" as const, text: "a" }, metadata: { actor: "t" }, children: [] as unknown[] };
    const b = { eventId: "b", correlationId: "a", causationId: "a", type: "NoteAdded" as const, seq: 2, globalSeq: 2, objectId: "o", occurredAt: "t", actor: "t", summary: "b", event: { type: "NoteAdded" as const, text: "b" }, metadata: { actor: "t" }, children: [a] };
    a.children.push(b);
    expect(() => renderTrace([a] as never, [])).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/organs/lens/render.test.ts`
Expected: FAIL — `./render.js` / `renderTrace` missing.

- [ ] **Step 3: Write the implementation**

In `src/organs/lens/render.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 plain-text renderer (no ANSI → deterministic, snapshot-testable; the
 * demo adds colour). One consumer of the structured TraceForest. Surfaces the
 * "why" first-class: the gate verdict, the draft, the perceived context, the
 * escalation reason, and the outcome — with domain events shown as context,
 * never hidden. A cycle (only possible from corrupt input) is surfaced, not
 * followed.
 */

import type { EpisodeSummary } from "./episode.js";
import type { TraceForest, TraceNode } from "./trace.js";

function header(e: EpisodeSummary): string {
  const verdict = e.status.toUpperCase();
  const op = e.status === "acted" ? "≥" : e.status === "escalated" ? "<" : "?";
  const gate = e.confidence !== null && e.threshold !== null ? `${e.confidence} ${op} ${e.threshold}` : "n/a";
  const tier = e.tier ?? "?";
  const outcome = e.outcome ? (e.outcome.wasCorrect ? "correct" : "incorrect") : "—";
  const perceived = e.perceivedObjectId !== null ? ` · perceived ${e.perceivedObjectId}@${e.perceivedSeq}` : "";
  return `▸ episode ${e.correlationId.slice(0, 8)} — ${verdict} (${gate}, ${tier}) — outcome: ${outcome}${perceived}`;
}

export function renderTrace(forest: TraceForest, episodes: readonly EpisodeSummary[] = []): string {
  const byCorrelation = new Map(episodes.map((e) => [e.correlationId, e]));
  const lines: string[] = [];
  const seen = new Set<string>();
  let count = 0;

  const walk = (node: TraceNode, depth: number): void => {
    const indent = "  ".repeat(depth);
    if (seen.has(node.eventId)) {
      lines.push(`${indent}↻ cycle: ${node.eventId} (already shown)`);
      return;
    }
    seen.add(node.eventId);
    count += 1;
    const flag = node.externalCause ? `↑(${node.externalCause.slice(0, 8)}) ` : "";
    lines.push(`${indent}● ${node.type}  ${flag}${node.summary}  [actor=${node.actor}]`);
    for (const child of node.children) walk(child, depth + 1);
  };

  for (const root of forest) {
    const episode = byCorrelation.get(root.correlationId);
    if (episode !== undefined && root.type === "DecisionProposed") {
      lines.push(header(episode));
    }
    walk(root, 0);
  }

  lines.push("");
  lines.push(`reconstructed from ${count} event(s) — no second source of truth`);
  return lines.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/organs/lens/render.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/organs/lens/render.ts src/organs/lens/render.test.ts
git commit -m "feat(lens): renderTrace — legible glass-box trace text"
```

---

## Task 5: Public surface + the `npm run lens` demo

**Files:**
- Create: `src/organs/lens/index.ts`
- Create: `examples/lens-trace.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the public surface**

In `src/organs/lens/index.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens — MARROW's Mark-native observability organ. Lens 0: the trace view, a
 * pure read-only projection of the decision chain (the trace IS the events).
 */

export { type TraceNode, type TraceForest, summaryOf, replayTrace } from "./trace.js";
export { type EpisodeSummary, summarizeEpisodes } from "./episode.js";
export { renderTrace } from "./render.js";
```

- [ ] **Step 2: Write the demo**

In `examples/lens-trace.ts`:
```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Lens 0 — see the agent's decision chain reconstructed from the Mark, with no
 * API key (a scripted decider stands in for the model):
 *
 *   npm run lens            # rendered trace
 *   npm run lens -- --json  # the structured TraceForest
 *
 * Nothing here reaches the outside world. The trace IS the events — no second
 * source of truth.
 */

import { InMemoryMark } from "../src/mark/index.js";
import { Cortex, FakeDecider } from "../src/organs/cortex/index.js";
import { replayTrace, summarizeEpisodes, renderTrace } from "../src/organs/lens/index.js";

async function seed(mark: InMemoryMark, id: string, text: string): Promise<void> {
  const created = await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "channel:email" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "channel:email" }, causedBy: created });
}

async function main(): Promise<void> {
  const mark = new InMemoryMark();
  await seed(mark, "complaint-acted", "My order never arrived and I want a status update.");
  await seed(mark, "complaint-escalated", "This is the third time and I'm considering legal action.");

  await new Cortex(mark, new FakeDecider({ draft: "We're sorry — your order ships tomorrow with tracking.", confidence: 0.92 }), { threshold: 0.8, actor: "cortex" }).run("complaint-acted");
  await new Cortex(mark, new FakeDecider({ draft: "We understand your frustration and are escalating.", confidence: 0.45 }), { threshold: 0.8, actor: "cortex" }).run("complaint-escalated");

  const json = process.argv.includes("--json");
  for (const id of ["complaint-acted", "complaint-escalated"]) {
    const events = await mark.read(id);
    console.log(`\n=== ${id} ===`);
    if (json) {
      console.log(JSON.stringify(replayTrace(events), null, 2));
    } else {
      console.log(renderTrace(replayTrace(events), summarizeEpisodes(events)));
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
```

- [ ] **Step 3: Add the script**

In `package.json`, add to `"scripts"` after the `"cortex:ab"` line:
```json
    "lens": "tsx examples/lens-trace.ts",
```

- [ ] **Step 4: Run the demo and eyeball it**

Run: `npm run lens`
Expected: two trace blocks — `complaint-acted` shows `▸ episode … — ACTED (0.92 ≥ 0.8, T3) — outcome: —`, the `ObjectCreated`/`AttributeSet` context, the proposed draft and `perceived complaint-acted@…`; `complaint-escalated` shows `ESCALATED (0.45 < 0.8, T3)` and the escalation reason. Then: `npm run lens -- --json` prints a `TraceForest`.

- [ ] **Step 5: Commit**

```bash
git add src/organs/lens/index.ts examples/lens-trace.ts package.json
git commit -m "feat(lens): public surface + npm run lens demo"
```

---

## Task 6: Full verification + capability-map update

**Files:**
- Modify: `docs/mark-capability-map.md`

- [ ] **Step 1: Typecheck and run the whole suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; all tests pass (existing suite + the new `src/organs/lens/*.test.ts`). If Postgres is not up, the `skipIf` Postgres tests are skipped as usual — that is expected.

- [ ] **Step 2: Record Lens 0 in the capability map**

In `docs/mark-capability-map.md`, under `## Status`, add a bullet after the "Decider adapters … — done." entry:
```markdown
- **Lens 0 (trace view) — done.** The first step of Lens, the Mark-native
  observability organ (`src/organs/lens/`). `replayTrace` folds an event stream
  into a causal forest (keyed by causationId, objectId-agnostic); `summarizeEpisodes`
  derives an audit-rich summary per decision correlationId (reusing `replayDecision`,
  restoring threshold/tier/draft/perceived/evidence); `renderTrace` makes the "why"
  legible. Pure projection, no second source of truth — the trace IS the events
  (ADR-0009/0004). Timing deferred to Lens 1 (a recorded Δ would misread as model
  latency). `npm run lens`. Spec: `docs/superpowers/specs/2026-06-15-lens-0-trace-view-design.md`.
```

- [ ] **Step 3: Add a finding (honest framing)**

In `docs/mark-capability-map.md`, under `## Findings from the Cortex slice`, add:
```markdown
- **The trace is a forest of short chains today, not a deep tree.** Lens 0 confirmed
  the only fan-out the codebase produces is `ObjectCreated → N×AttributeSet`; the
  decision chain is a straight line, and cross-object causation is still unthreaded
  (so `externalCause` is forward-looking, untriggerable by current data). The value
  of the trace view is the *legibility* of the gate decision, draft, perceived
  context and outcome — not graph structure. Confirms the cross-object "case"
  question stays open for the Cortex (ADR-0009).
```

- [ ] **Step 4: Commit**

```bash
git add docs/mark-capability-map.md
git commit -m "docs(lens): record Lens 0 in the capability map"
```

---

## Self-Review (completed against the spec)

- **Spec coverage:** causal forest (Task 2) · per-correlation episode header reusing `replayDecision` + restored audit fields (Task 3) · gate verdict / draft / perceived / outcome+evidence / domain-context-shown / on-thesis footer (Task 4) · structure-first with JSON output (Task 5) · timing omitted (no duration field — §6) · `externalCause` forward-looking + dangling-only (Task 2 test) · shuffle-invariance, duplicate-eventId throw, cross-object merge, degenerate inputs (Task 2) · cycle guard (Task 4) · exhaustive `summaryOf` (Task 1) · module layout, demo, capability-map (Tasks 5-6). All spec sections map to a task.
- **Placeholder scan:** none — every code/test step is complete.
- **Type consistency:** `replayTrace → TraceForest`, `summarizeEpisodes → readonly EpisodeSummary[]`, `renderTrace(forest, episodes)`; field names (`gateVerdict`, `perceivedObjectId`, `externalCause`, `confidence`/`tier`) consistent across trace.ts, episode.ts, render.ts and tests.
- **Note for the executor:** the cycle-guard test (Task 4) hand-builds cyclic nodes with `as never` casts to bypass `replayTrace`'s acyclic guarantee — this is intentional; do not "fix" it into going through `replayTrace`.
```
