// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type { z } from "zod";
import type { Json, MarkEvent } from "./event.js";
import { markEventSchema, parseMarkEvent, parseEventMetadata } from "./event-schema.js";

// Compile-time: every MarkEvent payload (the event minus `type`) is JSON, so the
// Postgres adapter's toPayload() cast to Record<string, Json> can never silently
// produce a non-JSON value (a future Date/branded field would break this).
type PayloadOf<E> = E extends MarkEvent ? Omit<E, "type"> : never;
type _PayloadIsJson = PayloadOf<MarkEvent> extends Record<string, Json> ? true : false;
const _payloadIsJson: _PayloadIsJson = true;
void _payloadIsJson;

// --- Compile-time guard: the static type and the runtime schema cannot drift.
// If a MarkEvent variant is added to one but not the other, z.infer and MarkEvent
// diverge, `Equal` resolves to `false`, and this assignment stops compiling
// (checked by `tsc --noEmit`, which includes test files). This is the single
// source-of-truth check the manual type/schema pair would otherwise lack.
type SchemaEvent = z.infer<typeof markEventSchema>;
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _schemaMatchesType: Equal<MarkEvent, SchemaEvent> = true;
void _schemaMatchesType;

describe("markEventSchema", () => {
  it("accepts a valid sample of every event variant", () => {
    expect(() => parseMarkEvent({ type: "ObjectCreated", id: "x", objectType: "ticket" })).not.toThrow();
    expect(() => parseMarkEvent({ type: "AttributeSet", key: "priority", value: "high" })).not.toThrow();
    expect(() => parseMarkEvent({ type: "StateChanged", state: "open" })).not.toThrow();
    expect(() => parseMarkEvent({ type: "NoteAdded", text: "note" })).not.toThrow();
  });

  it("accepts every agent decision-chain variant (ADR-0010)", () => {
    expect(() =>
      parseMarkEvent({ type: "DecisionProposed", draft: "Sorry…", perceivedObjectId: "c1", perceivedSeq: 2 }),
    ).not.toThrow();
    expect(() =>
      parseMarkEvent({ type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T3" }),
    ).not.toThrow();
    expect(() => parseMarkEvent({ type: "Acted", draftRef: "evt-1" })).not.toThrow();
    expect(() => parseMarkEvent({ type: "Escalated", reason: "below threshold" })).not.toThrow();
    expect(() => parseMarkEvent({ type: "OutcomeObserved", wasCorrect: true, evidence: null })).not.toThrow();
    expect(() =>
      parseMarkEvent({ type: "OutcomeObserved", wasCorrect: false, evidence: "customer confirmed" }),
    ).not.toThrow();
  });

  it("rejects a decision event with an invalid tier or missing field", () => {
    expect(() =>
      parseMarkEvent({ type: "ConfidenceAssessed", confidence: 0.9, threshold: 0.8, tier: "T9" }),
    ).toThrow();
    expect(() => parseMarkEvent({ type: "Acted" })).toThrow();
  });

  it("rejects an unknown type and extra keys", () => {
    expect(() => parseMarkEvent({ type: "Nope" })).toThrow();
    expect(() => parseMarkEvent({ type: "StateChanged", state: "open", extra: 1 })).toThrow();
  });

  it("rejects a payload with the wrong field type", () => {
    expect(() => parseMarkEvent({ type: "StateChanged", state: 42 })).toThrow();
  });
});

describe("eventMetadataSchema", () => {
  it("requires an actor", () => {
    expect(() => parseEventMetadata({})).toThrow();
    expect(() => parseEventMetadata({ actor: "system" })).not.toThrow();
  });

  it("keeps additional glass-box context (passthrough)", () => {
    const parsed = parseEventMetadata({ actor: "agent:cortex", trace: { step: 3 } });
    expect(parsed).toMatchObject({ actor: "agent:cortex", trace: { step: 3 } });
  });
});
