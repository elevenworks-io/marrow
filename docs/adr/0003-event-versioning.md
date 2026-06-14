# ADR-0003: Event versioning and forward compatibility

- **Status:** Accepted
- **Date:** 2026-06-14
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (append-only events are truth), ADR-0002 (TypeScript + zod validation at boundaries)

## Context

The Mark's events are not short-lived inter-service messages — they are **stored forever and replayed** to rebuild state, and they are also **exposed over MCP** to external agents (§3.6). The event schema *will* evolve. We need an evolution discipline that never violates the invariants: append-only (§3.1), glass-box (§3.2), and the Time Machine (§4).

Event sourcing offers two ways to evolve stored events:

- **In-store migration** — rewrite old events in place to the new shape.
- **Out-of-store migration (upcasting on read)** — leave stored events untouched; convert old shapes to the current shape during replay, before they are folded.

The kernel today validates every event against a single zod schema at the read boundary (ADR-0002). That is correct while there is one version, but it conflates "valid" with "matches today's shape" — which would reject historical events the moment the schema changes. This ADR fixes the evolution model before that bites.

## Decision

**Stored events are immutable; evolve by upcasting on read, never by rewriting.**

- **In-store migration is forbidden.** Rewriting history would break append-only (§3.1) and corrupt the audit trail and Time Machine — you would be auditing and replaying a *rewritten* past. This is not a stylistic choice; the invariants foreclose it.
- **Every event carries a per-type `schemaVersion`.**
- **Write path: strict, against the current version.** An append is validated strictly against the latest schema for its type (this is the drift guard from the kernel hardening, kept).
- **Read path: version-scoped, then upcast.** Each stored event is validated against *the version it declares*, then lifted through a chain of upcasters (linked-list: each version knows how to convert to the next) to the current shape before folding. Projections only ever see the latest shape. "Strict" on read means strict against the event's own version — never against today's schema.
- **Additive vs breaking.** Adding an optional field needs no version bump (tolerant reader: ignore unknown, default missing). Only a **breaking** change gets a new version + upcaster. The rule: *a new version must be convertible from the old; if it is not, it is a new event type, not a new version.*
- **Public event surface.** Events exposed over MCP follow additive-only evolution plus explicit versioning, because external consumers are the classic "old readers" and we do not control their deploy cadence.
- **Snapshots** (when introduced — see ADR-0001 / the capability map) are tagged with the event versions they were built from and rebuilt when those versions change.

## Consequences

**Positive**

- History is immutable forever; audit and the Time Machine reconstruct the *true* past, not a rewritten one.
- Zero-downtime schema evolution: deploy new readers/upcasters, no data migration, no backfill.
- Replay is always safe — old events remain readable through their upcasters indefinitely.

**Negative / costs we accept**

- An upcaster registry to maintain, with a test per upcaster (old fixture → current shape).
- Long-lived streams pay upcasting cost on every replay until a newer snapshot supersedes them.
- Discipline: contributors must bump+upcast on breaking changes rather than edit an event's shape in place.

## Alternatives considered

- **In-store migration.** Rejected — an invariant violation (§3.1) that corrupts audit/Time Machine.
- **A schema registry + Avro/Protobuf compatibility checks.** Deferred, not adopted. Heavier machinery than the kernel needs; zod-per-version plus the additive/breaking rule gives the same guarantees at our scale. Reconsider if a polyglot organ fleet needs cross-language schema enforcement.
- **Weak schema only (no versions, tolerant reader everywhere).** Insufficient: it handles additive change but has no answer for breaking change beyond hoping readers cope.

## Notes

Realizes **Layer 1** of the Mark capability map (envelope enrichment). Correlation/causation ids and idempotency keys are the other Layer-1 concerns and are recorded alongside this versioning decision as that layer is built.
