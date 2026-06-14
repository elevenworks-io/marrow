# ADR-0002: The stack — TypeScript on Node, PostgreSQL as the event store

- **Status:** Accepted
- **Date:** 2026-06-14
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (event-sourced substrate — the *pattern*; this ADR fixes the *technology*)

## Context

ADR-0001 fixed the **shape of truth**: the Mark is an append-only, event-sourced log; current state is a projection folded from events. It deliberately left the concrete stack open. This ADR chooses it.

We are not choosing a stack for a kernel in isolation. The kernel is small and almost any stack can express it. We are choosing the soil in which the *whole organism* (VISION.md §4) has to grow, while keeping the invariants (§3) as law. The forces that actually decide this:

1. **Event sourcing on the most boring durable primitive.** Append-only table → projections → replay. No distributed log, no streaming platform on day one (ADR-0001, "deliberate boredom in the plumbing"). The datastore must give us durable appends, monotonic ordering, transactional projection updates, and a clean self-hosted footprint.
2. **MCP both directions, first-class.** This is an invariant, not a nice-to-have (§3.6, the Nervous System). MARROW must *consume* external tools as MCP and *expose* its own objects/actions as an MCP server. The richness and maturity of the MCP SDK in the chosen language is a primary, not secondary, criterion.
3. **Model-agnostic agent work.** No hard dependency on one model vendor (§3.5). The Cortex routes deliberately across models. LLM calls are HTTP; what matters is mature, vendor-neutral client tooling and good streaming/tool-use ergonomics.
4. **Sovereign / self-hostable (EU or on-prem).** No hard lock-in to a single proprietary cloud (§3.5). The runtime and datastore must run on a customer's own box, in the EU, with a deployment story a regulated SMB can actually operate. Licensing of core dependencies must be clean (permissive), since MARROW ships under AGPL-3.0 + commercial.
5. **A clean, *typed*, immutable kernel.** CLAUDE.md is explicit: a *typed* immutable `Event`, an append-only log, **one** projection, a `replay`. The language must let us express discriminated event unions, exhaustive folds, and runtime-validated event payloads without ceremony.
6. **One substrate, not ten apps (§3.7), incl. the Skin.** The glass-box surfaces (the Skin) render traces and projections for humans. A web UI is inevitable. Sharing the `Event` and projection *types* between the substrate and the surfaces is a concrete win for a glass-box product.

The genuine tension: the **spine** wants boring, strongly-typed, durable plumbing (favours Go / Rust / JVM); the **organs** — Senses (document/voice intake), Cortex (agent runtime), Nervous System (MCP) — want the richest AI + MCP ecosystem (favours TypeScript / Python). The right call optimises for where the invariant-bearing, hard-to-get-right work lives — the agent runtime, MCP both directions, and glass-box — without making the plumbing exotic.

## Decision

**Adopt TypeScript on the Node.js LTS runtime, with PostgreSQL as the event store. Keep the dependency set small and boring; allow Python organs later as separate MCP-exposed services, never as a fork.**

Concretely:

- **Language:** TypeScript, in `strict` mode. Events are modelled as **discriminated unions**; folds are made exhaustive with `never`-checks; payloads are validated at the trust boundary with a runtime schema validator (e.g. Zod) so that "typed immutable Event" holds at *runtime*, not just at compile time.
- **Runtime:** Node.js LTS. The most boring, most durable, longest-supported JS runtime. (Bun/Deno are noted and rejected for *now* — see Alternatives.)
- **Datastore / event store:** PostgreSQL. A single append-only `events` table, `JSONB` payloads, a `BIGSERIAL` global sequence for total order, and a `UNIQUE (object_id, seq)` constraint for per-object monotonic ordering *and* optimistic concurrency. Append-only is enforced at the DB (revoke `UPDATE`/`DELETE`; no ORM that invites mutable-state thinking). Projections are plain folds; rebuildable at any time by replaying events.
- **Data access:** a thin SQL layer (`pg`), hand-written SQL migrations. **No ORM.** An ORM models mutable rows as truth — the exact anti-pattern ADR-0001 rejects.
- **MCP:** the official `@modelcontextprotocol/sdk` (TypeScript is the reference implementation), used in both directions.
- **LLM access:** vendor-neutral client layer; route per-task. No single-vendor SDK baked into the core.
- **Tests:** a fast TS test runner (e.g. Vitest). The kernel is proven by tests that assert `event → projection` and full `replay` equivalence **before** any organ is built (CLAUDE.md, "small, verifiable steps").
- **Surfaces (later):** the Skin is a TS/JS web app that **imports the same `Event` and projection types** from the substrate — one language end-to-end, shared truth types.

Illustrative kernel shape (not scaffolding — to show the path is clean):

```
events(
  global_seq   BIGSERIAL PRIMARY KEY,   -- total order across all objects
  object_id    TEXT NOT NULL,           -- the log is keyed by object id
  seq          INTEGER NOT NULL,        -- per-object monotonic sequence
  type         TEXT NOT NULL,           -- 'ObjectCreated' | 'AttributeSet' | ...
  payload      JSONB NOT NULL,
  metadata     JSONB NOT NULL,          -- glass-box: actor, reasoning, confidence, tools
  occurred_at  TIMESTAMPTZ NOT NULL,
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (object_id, seq)               -- monotonic + optimistic concurrency
);
-- append(event), replay(object_id) -> fold(events) -> state. One projection to start.
```

## The organ boundary contract

MARROW will be polyglot by design: the TypeScript spine plus organs that may be written in Python (LangChain/LangGraph, document-AI/OCR, voice, the learning loop) and run as **separate microservices**. This is on-thesis (§3.5/§3.6), not a substrate fork (§3.7) — but it is only safe under an explicit contract, so the invariants survive the language boundary:

1. **Truth lives only in the one Mark, as events.** No organ keeps an authoritative mutable database. Ephemeral/cache state is fine; "current state" is always a projection of the Mark, never a private row an organ calls its own.
2. **Organs talk over MCP, both directions** — they consume and are consumed as standard tools. No closed, one-off integrations where a tool interface belongs.
3. **The Mark is *the* durable-execution journal.** A framework's own checkpointer (e.g. LangGraph's Postgres/SQLite graph-state store) is **either ephemeral** — the run is disposable and only the meaningful steps are checkpointed into the Mark as events — **or it is backed by the Mark.** It is never a second, parallel journal the Mark cannot see. Two journals = two sources of truth = an invariant breach by the back door (§3.1).
4. **Glass-box crosses the boundary too** (§3.2). An autonomous action taken inside a Python organ must still leave enough in the Mark — context, reasoning, confidence, tools called — to reconstruct *why*. A capability MARROW cannot explain from the substrate should not be allowed to act.

The detailed "how the Cortex tames LangGraph" belongs in a later Cortex ADR; this contract is the guard rail that lets us reach for the Python ecosystem freely without losing the spine.

## Consequences

**Positive**

- **MCP both directions is strongest here.** The reference MCP SDK is TypeScript; consuming and exposing tools is first-class, satisfying an invariant rather than fighting the ecosystem for it.
- **Typed immutable kernel, cleanly.** Discriminated unions + exhaustive folds + a runtime validator express "typed immutable Event" precisely, with runtime guarantees at the append boundary.
- **One language, shared truth types.** Substrate, Cortex, and the Skin share `Event`/projection types. A glass-box UI that renders traces consumes the *same* types the Mark writes — directly serving §3.2 and the "one substrate" invariant.
- **Boring, sovereign plumbing.** PostgreSQL is the canonical boring durable primitive: trivially self-hostable in the EU/on-prem, decades of operational maturity, permissive license, append-only enforceable, projections rebuildable. No proprietary-cloud dependency.
- **Durable execution without new infrastructure.** ADR-0001 says the Mark *is* the durable-execution journal. We checkpoint agent steps as events; we do **not** need Temporal or a workflow engine to start. (If we ever do, Temporal has a first-class TS SDK — a later, reversible choice.)
- **Iteration speed + talent.** Large hiring pool; fast feedback loop for an early-stage build.

**Negative / costs we accept**

- **TS types are erasable.** Compile-time types don't enforce immutability or shape at runtime by themselves. We pay for runtime validation (Zod at the boundary) and `Object.freeze`/readonly discipline deliberately — accepted, and contained to the kernel's edges.
- **Node is not the best raw-compute runtime.** CPU-bound work (heavy document/ML) is not Node's strength. We accept this because such work belongs in dedicated organs reached over MCP/a service boundary (see below), not in the spine.
- **The richest document-AI / OCR / scientific ecosystem is Python, not TS.** The Senses (PDF/image/voice intake) and parts of the learning loop may genuinely want Python. We accept a **polyglot-at-the-organ-boundary** future: such organs run as separate services exposed over MCP — which is *on-thesis* (model- and language-agnostic, §3.5/§3.6), not a fork of the substrate (§3.7).
- **Discipline required.** "No ORM, append-only, events-are-truth" must be held by convention and DB grants, not handed to us by a framework.

## Alternatives considered

- **Python + PostgreSQL.** The default for AI-native products: the best document-AI/OCR/voice and ML ecosystem, a first-class MCP SDK, Pydantic for typed/validated events. *Rejected as the primary stack* (not as a future co-language) because: (a) MARROW's invariant-bearing core is the **agent runtime + MCP both directions + glass-box surfaces**, where TS's MCP story is the reference and where one language shared with the Skin pays off; (b) the Skin forces JS regardless, so Python backend ⇒ two languages and no shared truth types; (c) dynamic typing makes the "typed immutable Event" kernel more ceremony than TS's discriminated unions. Python remains explicitly welcome for ML-heavy organs, behind MCP.
- **Go + PostgreSQL.** The best "boring durable plumbing": single static binary (excellent on-prem/sovereign story), great concurrency, strong static typing. *Rejected* because the AI/MCP/agent/intake ecosystem is materially thinner, and the vision is overwhelmingly organ-centric (Senses, Cortex, Hands, Nervous System). We would win the spine and then fight the ecosystem for every organ — and we would *still* need a JS Skin. A lovely spine is not worth a fought-for body.
- **Elixir/BEAM (e.g. Commanded) or JVM (e.g. Axon).** Mature, purpose-built event-sourcing/CQRS frameworks with excellent durability and concurrency. *Rejected* as cutting against "deliberate boredom" and "don't reach for exotic infrastructure to feel advanced" (§3.8, CLAUDE.md): smaller talent pools, heavier conceptual surface, and AI/MCP ecosystems we'd be early in. The event-sourcing *pattern* is already ours from ADR-0001; we don't need a framework to hand it to us — an append-only table does.
- **Rust + PostgreSQL.** Maximal durability and performance. *Rejected for now*: build velocity and ecosystem maturity for agent/MCP work don't justify the cost at the kernel stage. Reconsiderable for a specific hot organ later, behind a service boundary.
- **An off-the-shelf event-store / streaming platform (EventStoreDB, Kafka).** Already deferred by ADR-0001. The boring append-only Postgres table is the right amount of infrastructure for the kernel; heavier machinery can be introduced later if scale demands it.
- **Bun or Deno instead of Node.** Tempting DX and TS-native ergonomics. *Rejected for now* on the "most boring, most durable" test: Node LTS has the longest operational track record and the widest library/ops support for a system customers will self-host for years. Revisit if a concrete need appears; the choice is reversible.

## Notes

- This ADR fixes the **stack**, not the kernel's code. The next step is the Spine kernel — typed immutable `Event` → append-only log → **one** projection → `replay` — proven by tests (`event → projection → replay`) before any organ is built.
- Per the licensing rule in CLAUDE.md, every source file carries the SPDX header (`AGPL-3.0-or-later`, `Copyright (C) 2026 elevenworks`). Core dependencies must stay permissively licensed (Node/MIT, PostgreSQL license, etc.) so the AGPL + commercial dual-license model is unencumbered.
- **Reversibility:** the language/runtime is the least reversible choice here and is made deliberately; the datastore (Postgres) and the no-ORM/thin-SQL stance are conservative and easy to live with; runtime (Node vs Bun/Deno) and any future durable-execution engine are explicitly reversible.
