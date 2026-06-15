// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryMark } from "../../mark/index.js";
import { createMarkMcpServer } from "./server.js";

/** Connect a client to a fresh Mark-backed MCP server over an in-memory pair. */
async function connect(): Promise<Client> {
  const server = createMarkMcpServer(new InMemoryMark(), "mcp:test");
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

/** Extract and parse the JSON text a tool returned. */
function result<T = unknown>(res: Awaited<ReturnType<Client["callTool"]>>): T {
  const content = res.content as Array<{ type: string; text?: string }>;
  const text = content[0]?.text ?? "";
  return JSON.parse(text) as T;
}

describe("Mark MCP server", () => {
  it("exposes the object/action tools", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "add_note",
      "change_state",
      "create_object",
      "get_history",
      "get_object",
      "list_objects",
      "set_attribute",
    ]);
    await client.close();
  });

  it("drives an object through its life over MCP, end to end", async () => {
    const client = await connect();

    const created = result<{ id: string; objectType: string }>(
      await client.callTool({
        name: "create_object",
        arguments: { objectType: "ticket", attributes: { subject: "Burst pipe" } },
      }),
    );
    expect(created.objectType).toBe("ticket");
    const { id } = created;

    await client.callTool({ name: "change_state", arguments: { id, state: "open" } });
    await client.callTool({ name: "add_note", arguments: { id, text: "dispatched" } });

    const got = result<{ state: string; attributes: Record<string, unknown>; notes: string[] }>(
      await client.callTool({ name: "get_object", arguments: { id } }),
    );
    expect(got.state).toBe("open");
    expect(got.attributes).toEqual({ subject: "Burst pipe" });
    expect(got.notes).toEqual(["dispatched"]);

    const list = result<unknown[]>(
      await client.callTool({ name: "list_objects", arguments: { objectType: "ticket" } }),
    );
    expect(list).toHaveLength(1);

    const history = result<Array<{ event: { type: string }; metadata: { actor: string } }>>(
      await client.callTool({ name: "get_history", arguments: { id } }),
    );
    expect(history[0]?.event.type).toBe("ObjectCreated");
    expect(history.every((e) => e.metadata.actor === "mcp:test")).toBe(true);

    await client.close();
  });

  it("returns an error result for an unknown object", async () => {
    const client = await connect();
    const res = await client.callTool({ name: "get_object", arguments: { id: "ghost" } });
    expect(res.isError).toBe(true);
    await client.close();
  });
});
