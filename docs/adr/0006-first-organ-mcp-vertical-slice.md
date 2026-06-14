# ADR-0006: First organ — expose the Mark over MCP (the vertical slice)

- **Status:** Accepted
- **Date:** 2026-06-14
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001–0005; realizes VISION §3.6 and the Nervous System (the "expose" direction)

## Context

The biggest risk in building the Mark layer by layer is **perfecting a substrate that no organ has ever stressed** — much beautiful infrastructure, no top-down pressure to validate that the object/event/action model is actually usable. Before we go deep on memory (Layer 3b) and the Time Machine (Layer 4), we want to drive the substrate from real usage.

The right move is a **thin vertical slice through an organ**: top (an external caller) → through an organ → to the spine → and back. The thinnest possible organ is the one that adds no intelligence of its own.

## Decision

**After Layer 1 + a minimal Layer 2, build an MCP server that exposes the Mark's objects and actions as tools.**

- **~5 tools, backed entirely by the kernel + one minimal read model:**
  - `create_object(objectType, attributes?)` → appends `ObjectCreated` (+ `AttributeSet`), returns the id
  - `get_object(id)` → the projected state (`load`)
  - `set_attribute` / `change_state` / `add_note` → append the corresponding event
  - `get_history(id)` → the event list (the glass-box "why", surfaced directly)
  - `list_objects(objectType)` → the first tiny query read model
- **A true vertical slice:** external caller → MCP organ → spine → back, exercising the append path, the projection, replay, glass-box metadata (`actor` = the calling agent), and optimistic concurrency surfaced as a tool error.
- **Dogfood it:** drive the server from a general assistant (e.g. Claude) as the test harness — the substrate's first real external agent.
- **`list_objects` pulls the first cross-object read model into existence** — minimal Layer 2 with *real demand*, not built speculatively.
- **Its feedback steers the roadmap:** does the object model map cleanly to tool schemas? Are richer actions needed? Is `actor` metadata enough for glass-box when the caller is external? How should optimistic-concurrency conflicts read as tool errors? Where does the query side hurt without deeper Layer 2? The answers decide how deep we go on Layer 2, memory, and the Time Machine.

## Consequences

**Positive**

- Delivers a VISION invariant early (§3.6 — a citizen of the agent ecosystem; the Nervous System's expose direction).
- Validates the substrate under real, external load before heavy organs are built.
- Dogfoodable from day one; the test harness is a real agent.
- Pulls minimal Layer 2 into existence with purpose, avoiding speculative projection work.

**Negative / costs we accept**

- Some throwaway risk if the tool surface changes as we learn — acceptable for a deliberately thin slice.
- Requires wiring the MCP server SDK (ADR-0002) and a first minimal read model.

## Alternatives considered

- **Build the Senses or the Cortex first.** Rejected — heavy organs (document/voice intake, an agent loop) before the substrate is validated; far more to build and much slower feedback.
- **No organ until the Mark is "complete."** Rejected — that *is* the failure mode this ADR guards against: a substrate with no top-down pressure.

## Notes

Realizes the **cross-cutting vertical slice** in the Mark capability map. Sequenced after Layer 1 (ADR-0003) and a minimal Layer 2 (ADR-0004); the schema it uses starts minimal (objectType as a string, open attributes) and is hardened later by schema-morph (ADR-0005).
