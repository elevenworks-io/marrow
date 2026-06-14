# ADR-0001: An event-sourced substrate is the single source of truth

- **Status:** Accepted
- **Date:** 2026-06-14
- **Decision owner:** elevenworks / MARROW

## Context

MARROW’s thesis (see `VISION.md`) is that back-office software is collapsing from many siloed applications into one configurable substrate, with an autonomous agent running on top of it. Four product promises define the thing we are building:

1. **It acts autonomously** and must survive long-running, interruptible work.
1. **It remembers everything** it has ever done and uses that memory to act.
1. **It learns over night** — every resolved case makes it better, without retraining.
1. **It can prove every decision** it ever made (glass-box; saleable into regulated, audit-heavy environments).

Each of these promises has the same structural requirement: the system’s history must be *primary*, not derived. Conventional software does the reverse — it keeps mutable current state as the source of truth and (sometimes) writes an audit log on the side. An audit log on the side cannot reliably reconstruct *why* an autonomous agent did something, cannot serve as the agent’s memory, cannot be replayed to resume durable work, and is not a clean learning signal. Retrofitting these properties onto a mutable-state core is, in practice, not achievable cleanly.

## Decision

**The Mark — an append-only, event-sourced log — is the single source of truth.**

- Every perception, decision, action, and state change is recorded as an immutable event.
- The current state of any object is a **projection** computed by folding its events; it is a cache, never the authority.
- Authoritative reads must be reconstructable by replaying events.

This one structure is, simultaneously:

- the **durable-execution journal** (long-running agent work checkpoints here, survives restarts, retries idempotently, resumes);
- the agent’s **memory** (episodic and long-term);
- the **audit trail** (any decision reconstructable in full: context, reasoning, confidence, tools called);
- the **simulation substrate** (replay history to test new agent behavior before it goes live — the “Time Machine”);
- the **learning signal** (resolved cases become retrievable precedent).

## Consequences

**Positive**

- Trust, memory, durable execution, time-travel simulation, and the self-improvement loop are *properties of the substrate*, not separate subsystems to be built and reconciled. This is the entire competitive position in one decision.
- Glass-box explainability and EU/on-prem auditability come for free, which is the wedge against cloud-only incumbents.
- Decouples write history from read shape: new projections (new “apps”/domains) can be derived without rewriting truth — supports the one-substrate-not-ten-apps invariant.

**Negative / costs we accept**

- More upfront discipline. Writers emit events; projections must be maintained and kept correct.
- Projections introduce read-side eventual consistency to reason about explicitly.
- Schema/versioning of events needs care over time (events are immutable and long-lived).
- This is a deliberately higher-effort foundation than a CRUD app. We accept it because the product promises are impossible without it.

## Alternatives considered

- **Fork an existing open-source helpdesk (e.g. Zammad) for the substrate.** Rejected. Their data model carries real domain wisdom (worth studying), but the history is an audit log attached to mutable Rails state — exactly the architecture this ADR rejects. We would inherit the skeleton but not the Mark, and the Mark is the point. (License also matters: such projects are typically AGPL, and copyleft entanglement in a commercial managed offering is not something to inherit by accident.)
- **Mutable state + a side audit log.** Rejected. Cannot reliably serve as agent memory, durable-execution journal, replayable simulation, or clean learning signal. It is precisely the conventional pattern whose limits motivate MARROW.
- **An off-the-shelf event-store/streaming platform from day one.** Deferred, not adopted now. The *pattern* (event sourcing) is the decision; the *technology* is ADR-0002. Starting with the most boring durable primitive that works (an append-only table) is the right amount of infrastructure for the kernel. We can introduce heavier machinery later if scale demands it.

## Notes

The concrete stack (language, runtime, datastore, libraries) is intentionally **not** decided here — see ADR-0002. This ADR fixes the *shape* of truth, not the implementation.