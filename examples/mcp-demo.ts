// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * Watch an agent drive the Mark over MCP — live, through the real stdio server.
 *
 *   npm run mcp:demo
 *
 * This spawns `npm run mcp` (the same entry point an assistant connects to),
 * speaks the real MCP protocol to it, and narrates each tool call and what the
 * substrate did in response. Runs on an in-memory Mark, so it needs no database.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const useColor = !process.env.NO_COLOR;
const sgr = (c: string) => (s: string) => (useColor ? `\x1b[${c}m${s}\x1b[0m` : s);
const bold = sgr("1");
const dim = sgr("2");
const cyan = sgr("36");
const green = sgr("32");
const yellow = sgr("33");

function header(n: string, title: string): void {
  console.log("");
  console.log(cyan(bold(`${n}  ${title}`)));
  console.log(cyan("─".repeat(64)));
}

function parse<T = any>(res: Awaited<ReturnType<Client["callTool"]>>): T {
  const content = res.content as Array<{ type: string; text?: string }>;
  return JSON.parse(content[0]?.text ?? "null") as T;
}

async function main(): Promise<void> {
  console.log(cyan("╔" + "═".repeat(64) + "╗"));
  console.log(cyan("║ ") + bold("AN AGENT DRIVES THE MARK — over real MCP, live") + cyan(" ".repeat(17) + "║"));
  console.log(cyan("╚" + "═".repeat(64) + "╝"));

  // Spawn the real server exactly as an assistant would, and speak MCP to it.
  const transport = new StdioClientTransport({
    command: "npm",
    args: ["--silent", "run", "mcp"],
    env: { ...process.env, MARROW_MCP_ACTOR: "mcp:demo-agent" } as Record<string, string>,
  });
  const client = new Client({ name: "demo-agent", version: "0.0.0" });
  await client.connect(transport);

  const call = async (name: string, args: Record<string, unknown>) => {
    console.log(`   ${yellow("→ tool")} ${bold(name)} ${dim(JSON.stringify(args))}`);
    return client.callTool({ name, arguments: args });
  };

  // ① the agent sees what it can do
  header("①", "The agent connects and discovers the tools");
  const { tools } = await client.listTools();
  console.log(`   ${green("✓")} ${tools.length} tools: ${dim(tools.map((t) => t.name).join(", "))}`);

  // ② the agent creates a ticket
  header("②", "The agent creates a ticket");
  const created = parse<{ id: string; objectType: string; attributes: unknown }>(
    await call("create_object", { objectType: "ticket", attributes: { subject: "Burst pipe at 23:40" } }),
  );
  const id = created.id;
  console.log(`   ${green("✓")} object ${dim(id.slice(0, 8))} created ${dim(JSON.stringify(created.attributes))}`);
  console.log(`     ${dim("(behind the scenes: ObjectCreated + AttributeSet events were appended)")}`);

  // ③ the agent works it
  header("③", "The agent works the ticket");
  await call("set_attribute", { id, key: "priority", value: "emergency" });
  await call("change_state", { id, state: "open" });
  await call("add_note", { id, text: "Dispatched on-call technician" });
  await call("change_state", { id, state: "resolved" });

  // ④ the agent reads the current state back
  header("④", "The agent reads the current state");
  const state = parse<{ state: string; attributes: Record<string, unknown>; notes: string[] }>(
    await call("get_object", { id }),
  );
  console.log(`   ${green("✓")} ${bold(JSON.stringify({ state: state.state, attributes: state.attributes, notes: state.notes }))}`);

  // ⑤ it shows up in the type listing
  header("⑤", "It appears in the list of tickets");
  const list = parse<unknown[]>(await call("list_objects", { objectType: "ticket" }));
  console.log(`   ${green("✓")} list_objects('ticket') → ${bold(String(list.length))} object(s)`);

  // ⑥ glass-box: the whole "why", with the actor
  header("⑥", "Glass-box: the agent asks for the full history");
  const history = parse<Array<{ seq: number; event: { type: string }; metadata: { actor: string } }>>(
    await call("get_history", { id }),
  );
  for (const e of history) {
    console.log(`   ${green("●")} #${e.seq} ${e.event.type.padEnd(14)} ${dim("by " + e.metadata.actor)}`);
  }

  console.log("");
  console.log(cyan("─".repeat(64)));
  console.log(`   ${green("✓")} ${bold("Everything above was real MCP over stdio")} — the same path Claude uses.`);
  console.log(dim("   Every action is an immutable event, attributed, replayable, tamper-proof.\n"));

  await client.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
