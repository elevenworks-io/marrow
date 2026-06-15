// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The Mark exposed as an MCP server (ADR-0006, VISION §3.6 — the Nervous System,
 * "expose" direction). A thin shell: each tool maps to a MarkService method and
 * returns the resulting state/history as text. The substrate becomes drivable by
 * any MCP client — another agent, or a general assistant.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Json, Mark } from "../../mark/index.js";
import { MarkService } from "./service.js";

function ok(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function notFound(id: string) {
  return {
    content: [{ type: "text" as const, text: `Object "${id}" not found.` }],
    isError: true,
  };
}

/** Build an MCP server that exposes a Mark's objects and actions as tools. */
export function createMarkMcpServer(mark: Mark, actor = "mcp"): McpServer {
  const svc = new MarkService(mark, actor);
  const server = new McpServer(
    { name: "marrow-mark", version: "0.1.0" },
    {
      instructions:
        "Create, mutate, read, and inspect the full history of objects in the Mark — " +
        "an append-only, event-sourced substrate. Every write becomes an immutable " +
        "event recorded with you as the actor; nothing is ever overwritten.",
    },
  );

  server.registerTool(
    "create_object",
    {
      description: "Create a new object of a type, optionally with initial attributes.",
      inputSchema: {
        objectType: z.string().describe("the kind of object, e.g. 'ticket', 'invoice', 'lead'"),
        attributes: z.record(z.unknown()).optional().describe("initial attribute key/values"),
      },
    },
    async ({ objectType, attributes }) =>
      ok(await svc.createObject(objectType, (attributes ?? {}) as Record<string, Json>)),
  );

  server.registerTool(
    "get_object",
    {
      description: "Get the current (projected) state of an object by id.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      const state = await svc.getObject(id);
      return state === null ? notFound(id) : ok(state);
    },
  );

  server.registerTool(
    "set_attribute",
    {
      description: "Set an attribute on an object.",
      inputSchema: { id: z.string(), key: z.string(), value: z.unknown() },
    },
    async ({ id, key, value }) => ok(await svc.setAttribute(id, key, value as Json)),
  );

  server.registerTool(
    "change_state",
    {
      description: "Change the state of an object (e.g. 'open', 'resolved').",
      inputSchema: { id: z.string(), state: z.string() },
    },
    async ({ id, state }) => ok(await svc.changeState(id, state)),
  );

  server.registerTool(
    "add_note",
    {
      description: "Append a note to an object.",
      inputSchema: { id: z.string(), text: z.string() },
    },
    async ({ id, text }) => ok(await svc.addNote(id, text)),
  );

  server.registerTool(
    "get_history",
    {
      description: "Get the full, immutable event history of an object — the glass-box 'why'.",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => ok(await svc.getHistory(id)),
  );

  server.registerTool(
    "list_objects",
    {
      description: "List the current state of every object of a type.",
      inputSchema: { objectType: z.string() },
    },
    async ({ objectType }) => ok(await svc.listObjects(objectType)),
  );

  return server;
}
