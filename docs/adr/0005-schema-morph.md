# ADR-0005: Schema-morph — schema as events, object types as projections

- **Status:** Accepted
- **Date:** 2026-06-14
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (events are truth), ADR-0003 (event versioning), ADR-0004 (schema is itself a projection)

## Context

The core thesis (VISION §1, §5 "Schema-morph") is that **one substrate becomes any back-office category** — helpdesk, invoicing, intake — by reconfiguring its object model and workflows, not by forking code (§3.7). That requires the object schema to be **configurable data**, not hardcoded types.

We studied **Zammad's ObjectManager** (the OSS helpdesk) as prior art. Its model, source-grounded:

- Attribute definitions live as rows in `object_manager_attributes`; applying them runs **real `ALTER TABLE` migrations at runtime** (`migration_execute`), so each custom attribute becomes a real typed column.
- A closed set of ~19 `DATA_TYPES`, each declaring its own config keys in a serialized `data_option` blob (`maxlength`, `min`/`max`, `options`, `relation`, …), validated by one `DataOptionValidator`.
- Three separated concerns: storage type (`data_type`), constraints (`data_option`), and presentation+requiredness (`screens`, keyed **screen → role → rules**, so "required" is contextual, not `NOT NULL`).
- A reviewable **two-phase lifecycle**: `to_create/to_migrate/to_delete` → "migration pending" → `migration_execute` or `discard_changes`.
- Relations as a thin descriptor (`relation` + `relation_condition` + `belongs_to` + `multiple`); object identity interned in `object_lookups`; reserved-name guarding.
- Object *types* are **hardcoded** (`list_objects` returns a fixed array); only *attributes* are runtime-configurable.

There is real domain wisdom here to borrow — and one mechanism to invert.

## Decision

**Make the schema itself event-sourced: schema is data folded from schema events, and object instances stay projections — so reconfiguration costs no data migration.**

- **Schema changes are events:** `ObjectTypeDefined`, `AttributeDefined`, `AttributeConstraintChanged`, `AttributeRetired`, `AttributeProposalRejected`. The active schema is a **projection** folded from them (ADR-0004). There is **no `ALTER TABLE`, ever.**
- **Instances are already projections over their events**, so adding/removing/changing an attribute *reinterprets the fold* — zero data migration, instant and retroactively safe (old instances simply lack a new attribute → optional/default). A retired attribute stops surfacing but **its events remain** (glass-box).
- **Object types are user-definable** (the object registry is a projection) — going beyond Zammad, which hardcodes the object list. This is what actually delivers "becomes any app."
- **Borrow from Zammad:** a **closed attribute type system** (each type declares its constraint keys); the **three separated concerns** (storage type / constraints / presentation+requiredness *per surface × role*, requiredness contextual not `NOT NULL`); **relations as a thin descriptor** (target + condition + cardinality); **interned object-type identity**; **reserved-name guarding**; and a **reviewable two-phase intent** (proposed → activated). But "discard" is a **superseding event**, never a destroy — even abandoned proposals stay in the Mark, so we can reconstruct *why* the schema looks as it does.
- **Instance validation is schema-derived at runtime:** the schema projection emits a **zod validator per object type/version**; an `AttributeSet` on an instance is validated against the *active* schema at append. Compile-time per-domain TypeScript types are an optional *generated* DX convenience, never the source of truth.

**Timing and scope — the part that must be right now:** this is real work and belongs at **Layer 2** (it *is* a projection, and depends on ADR-0003 versioning). We do **not** build the engine at the kernel stage. But we **lock the direction now**, because the expensive mistake is cheap to avoid today:

> The kernel's single hardcoded projection stays as a *proof*. It must **not** grow into a tree of hardcoded per-domain TypeScript types — that path is "ten apps" and forks the substrate (§3.7). It generalizes into the **schema-driven generic object projection**. Schema is event-folded data; object types are projections.

## Consequences

**Positive**

- Schema evolution with **no migration, no downtime, and full history** — this is the event-sourcing thesis paying off, and a hard differentiator against DDL-migration systems like Zammad.
- "One substrate becomes any app" by configuration, not code (§3.7).
- Every attribute value change is an event → **per-field audit/history for free**, which Zammad lacks without a separate change log.

**Negative / costs we accept**

- We lose compile-time per-domain typing; safety moves to **runtime, schema-derived** validation (consistent with ADR-0002/0003).
- Schema-as-data risks "blob mush" (Zammad's `data_option`/`screens` are schemaless text) — mitigated by the closed type system + zod validators.
- Real Layer-2 engineering; not free.

## Alternatives considered

- **Per-domain code and types.** Rejected — that is "ten apps"/forking the substrate (§3.7), the exact failure VISION warns against.
- **Zammad-style runtime DDL migration per change.** Rejected — mutable-state as truth, downtime on change, no per-field history, and it cannot add fields retroactively without backfill. We borrow its wisdom and invert its mechanism.
- **A fixed object model in the kernel.** Rejected — forecloses schema-morph, the core thesis.

## Notes

Source files read in Zammad (`zammad/zammad`): `app/models/object_manager/attribute.rb`, `app/models/object_manager.rb`, `app/models/object_manager/attribute/data_option_validator.rb`, `db/migrate/20120101000001_create_base.rb`. Realizes the **Schema-morph** capability (Layer 2) in the Mark capability map.
