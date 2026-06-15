// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * MarkService — the first organ's core, independent of the MCP protocol.
 *
 * It exposes the Mark's objects and actions as a handful of plain async methods
 * over a `Mark` instance, so an external agent can create objects, mutate them,
 * read their state, and inspect their full glass-box history. Every write is
 * stamped with the caller as `actor` (ADR-0001 §3.2). The MCP server
 * (`server.ts`) is a thin shell that maps these methods to tools; all the logic
 * and tests live here, against the in-memory Mark.
 */

import { randomUUID } from "node:crypto";
import type {
  EventMetadata,
  Json,
  Mark,
  ObjectState,
  RecordedEvent,
} from "../../mark/index.js";

export class MarkService {
  constructor(
    private readonly mark: Mark,
    private readonly actor = "mcp",
  ) {}

  /** Create a new object of a type, optionally with initial attributes. */
  async createObject(
    objectType: string,
    attributes: Readonly<Record<string, Json>> = {},
  ): Promise<ObjectState> {
    const id = randomUUID();
    const created = await this.mark.append(
      id,
      { type: "ObjectCreated", id, objectType },
      { metadata: this.#meta() },
    );
    for (const [key, value] of Object.entries(attributes)) {
      await this.mark.append(
        id,
        { type: "AttributeSet", key, value },
        { metadata: this.#meta(), causedBy: created },
      );
    }
    return this.#stateOf(id);
  }

  /** Current projected state of an object, or null if it does not exist. */
  async getObject(id: string): Promise<ObjectState | null> {
    return this.mark.load(id);
  }

  async setAttribute(id: string, key: string, value: Json): Promise<ObjectState> {
    await this.mark.append(id, { type: "AttributeSet", key, value }, { metadata: this.#meta() });
    return this.#stateOf(id);
  }

  async changeState(id: string, state: string): Promise<ObjectState> {
    await this.mark.append(id, { type: "StateChanged", state }, { metadata: this.#meta() });
    return this.#stateOf(id);
  }

  async addNote(id: string, text: string): Promise<ObjectState> {
    await this.mark.append(id, { type: "NoteAdded", text }, { metadata: this.#meta() });
    return this.#stateOf(id);
  }

  /** The full event history of an object — the glass-box "why". */
  async getHistory(id: string): Promise<readonly RecordedEvent[]> {
    return this.mark.read(id);
  }

  async listObjects(objectType: string): Promise<readonly ObjectState[]> {
    return this.mark.listObjects(objectType);
  }

  #meta(): EventMetadata {
    return { actor: this.actor };
  }

  /** Load state right after a successful write — it cannot be missing. */
  async #stateOf(id: string): Promise<ObjectState> {
    const state = await this.mark.load(id);
    if (state === null) {
      throw new Error(`object "${id}" vanished after a successful append`);
    }
    return state;
  }
}
