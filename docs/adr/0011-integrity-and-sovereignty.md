# ADR-0011: Integrity and sovereignty — hash-chain, crypto-shredding, sovereign inference (cross-cutting)

- **Status:** Accepted
- **Date:** 2026-06-15
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (append-only), ADR-0002 (sovereign stack)

## Context

MARROW sells into regulated, audit-heavy environments and is **sovereign by default** (§3.5): data *and* inference must run in the EU or on the customer's own infrastructure, with no hard dependency on a single proprietary cloud or model vendor. Append-only is already enforced in Postgres by triggers (no `UPDATE`/`DELETE`/`TRUNCATE`). Three gaps remain: cryptographic tamper-**evidence**, the GDPR "right to erasure" vs an immutable log, and sovereign inference.

Research: the **Amazon QLDB** model (a hash-chained journal + a Merkle tree over it, exposed as a verifiable *digest*) and Crosby–Wallach append-only Merkle logs give cryptographic integrity — QLDB's lesson being that a self-verifiable digest with no external anchor is weak. **Crypto-shredding** (encrypt per-subject, destroy the key) reconciles immutability with erasure; the EDPB's Guidelines 02/2025 address exactly this for immutable ledgers. The **EU AI Act** requires high-risk systems to keep automatic, traceable logs (Art. 12; ≥6 months), with main provisions applying 2 Aug 2026. Sovereign inference is delivered by open-weight models (Llama/Mistral/Qwen) served via vLLM/Ollama/TGI behind a model-agnostic router.

## Decision

**Add cryptographic tamper-evidence, reconcile GDPR via crypto-shredding, and keep inference model-agnostic and EU/on-prem-capable.**

- **Tamper-evidence:** a **per-event hash chain** (each event hashes the previous event's hash + its own canonical content) plus a **periodic signed digest** published to the customer/auditor (optionally externally anchored, since QLDB shows self-verifiable digests are not enough). This gives cryptographic proof the log was neither altered nor reordered — cheap and Postgres-native, layered on the existing append-only triggers.
- **GDPR right-to-erasure via crypto-shredding:** encrypt per-subject PII fields with a **per-subject key**, and compute the hash chain / integrity proofs over the **ciphertext**, so erasure never breaks the chain. "Erase" = **destroy the key**; the event stays, its personal data becomes cryptographically unrecoverable. This reconciles §3.1 (append-only) with GDPR Art. 17 (EDPB 02/2025 supports this direction).
- **AI Act record-keeping is satisfied by construction:** the glass-box Mark is automatic, reconstructable, traceable logging that far exceeds the Art. 12 retention floor — a compliance asset, not a bolt-on.
- **Sovereign inference:** a **model-agnostic router** in front of pluggable backends — EU/on-prem open-weight models (vLLM/Ollama/TGI) and/or EU API providers — with **no hard dependency on one vendor** (§3.5). The honest frontier capability gap is managed by **deliberate routing**: a strong model orchestrates, cheaper/local models handle narrow sub-tasks (VISION §4 Cortex).
- **Multi-tenancy:** tenant isolation in the shared event store (per-tenant partitioning + encryption); keys are per-tenant/per-subject, which is also what makes crypto-shredding possible.

## Consequences

**Positive**

- Auditor-grade, **cryptographic** integrity on top of the append-only guarantee — proof, not just policy.
- GDPR-compatible immutability: erasure without breaking the log or its proofs.
- EU AI Act record-keeping comes essentially free from the Mark.
- Genuine sovereignty and vendor independence — the moat cloud-only incumbents structurally cannot cross (§3.5).

**Negative / costs we accept**

- **Key management becomes critical infrastructure** — crypto-shredding is only as strong as key destruction; lose a key by accident and you have lost data.
- Hashing over ciphertext constrains how PII fields are laid out in events.
- Open-weight/EU models trail frontier cloud models in raw capability; routing manages but does not erase the gap.

## Alternatives considered

- **Rely on the Postgres append-only triggers alone.** Rejected — triggers stop *our* code from mutating, but give a skeptical auditor no cryptographic proof against a privileged operator. Hash-chain + digest closes that.
- **Physically delete rows for GDPR.** Rejected — breaks append-only and every integrity proof; crypto-shredding is the reconciliation.
- **A single cloud model vendor for quality.** Rejected — violates §3.5; route deliberately across sovereign backends instead.

## Notes

Cross-cutting (the Immune System). Sources: Amazon QLDB verification model; Crosby–Wallach tamper-evident logs; Verraes "Crypto-Shredding: throw away the key"; EDPB Guidelines 02/2025; EU AI Act Art. 12 (record-keeping); vLLM / llm-d sovereign-inference writing.
