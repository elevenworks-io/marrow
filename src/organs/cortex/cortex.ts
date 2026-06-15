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
