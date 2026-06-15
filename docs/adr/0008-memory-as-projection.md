# ADR-0008: Memory and retrieval as a rebuildable projection (Layer 3b)

- **Status:** Accepted (provisional — revisit after the ADR-0006 vertical slice)
- **Date:** 2026-06-15
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (events are truth), ADR-0004 (projection framework)

## Context

VISION promises that every resolved case becomes **retrievable precedent**, and that the system "learns over night without retraining" because its **memory grows richer** (§3.4). The Mark already *is* the agent's episodic memory by construction — every perception, decision, and action is an event. The hard constraint: any *derived* memory (a semantic index, extracted precedents) must **never** become a second source of truth — it must be a rebuildable projection of the Mark (ADR-0001/0004).

Research (2024–2026): agent-memory architectures (MemGPT/Letta, Generative Agents' memory-stream + importance/recency + reflection, Mem0, A-MEM); hybrid retrieval (vector + keyword) consistently beats pure vector; pgvector (HNSW, with pgvectorscale) is viable at scale; episodic→semantic *consolidation* is the fragile, still-unsolved part — which our rebuildability directly mitigates (you can always re-derive).

## Decision

**Model memory as a rebuildable projection of the Mark; the Mark stays the only truth.**

- **Episodic memory = the Mark itself.** No copy, no separate store.
- **Semantic retrieval = a projection:** embeddings in **pgvector (HNSW) inside the same PostgreSQL** (add pgvectorscale if needed) — not a separate vector database. This honours sovereignty and the one-boring-datastore stance (ADR-0002).
- **Hybrid retrieval:** vector + BM25/keyword, fused (Reciprocal Rank Fusion), cross-encoder rerank, weighted by **relevance + recency + importance**.
- **Importance is grounded in outcome signals already in the Mark** — case value, whether it escalated, the decision's confidence, whether the resolution stuck — not only an LLM-assigned salience score. This makes the weighting both better-calibrated and **glass-box** (the signal is auditable).
- **"Learn overnight" = nightly consolidation/reflection jobs** that read events and **append gated, glass-box *derived* events** (extracted precedents, summaries, entity links). They **never mutate authoritative state**; the entire memory system remains a projection and is re-derivable from genesis.
- **Snapshots are droppable caches** for index rebuilds (so rebuilding the semantic index need not replay from genesis) — explicitly not a source of truth.
- **Bi-temporal staleness:** a later corrective event **supersedes** (never erases) an earlier one in the projection; retrieval prefers the latest valid derived state.

## Consequences

**Positive**

- Memory grows automatically as cases resolve; precedent is retrievable and **auditable**; "learning" is memory growth, not fine-tuning (exactly VISION §3.4).
- Fully rebuildable — a bad consolidation run is recoverable by re-deriving; no corruption of truth.
- Sovereign: one Postgres, no external vector service.

**Negative / costs we accept**

- Consolidation, identity resolution, and staleness are genuinely unsolved at the frontier — we plan for them rather than assume them solved.
- Embedding compute, index maintenance, and nightly jobs to operate.

## Alternatives considered

- **A dedicated vector database (Qdrant/Weaviate/Milvus) from the start.** Rejected for the sovereign single-Postgres start — a second datastore and a sovereignty/ops surface. Reconsider only if pgvector+pgvectorscale demonstrably can't carry the load.
- **A mutable memory store the agent writes to directly.** Rejected — a second source of truth, breaking ADR-0001.
- **"Learn" by periodically fine-tuning a model.** Rejected — VISION is explicit that improvement comes from richer memory, not retraining.

## Notes

Realizes **Layer 3b**. Sources: Mem0 (arXiv:2504.19413, Apr 2025); "Memory for Autonomous LLM Agents" survey (arXiv:2603.07670); Letta memory blocks; Generative Agents (memory stream + reflection); event-driven.io read-model / rebuild guidance; pgvector / pgvectorscale.
