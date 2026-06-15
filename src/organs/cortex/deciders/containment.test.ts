// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

/**
 * The model-agnostic guarantee, enforced (§3.5): the vendor SDKs may be imported
 * ONLY inside their own adapter files. Every other file under src/organs/cortex/
 * — the whole Cortex core — must be free of `@anthropic-ai/sdk` and `openai`
 * imports, so the substrate never depends on a single model vendor. If a future
 * change reaches for an SDK in the core, this test fails.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const CORTEX_DIR = join(process.cwd(), "src", "organs", "cortex");

/** Files allowed to import a vendor SDK — the adapters themselves. */
const ADAPTER_FILES = new Set([
  join(CORTEX_DIR, "deciders", "anthropic.ts"),
  join(CORTEX_DIR, "deciders", "openai.ts"),
]);

const FORBIDDEN_SPECIFIERS = ['"@anthropic-ai/sdk"', '"@anthropic-ai/sdk/', '"openai"', '"openai/'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("vendor SDK containment", () => {
  it("no Cortex core file imports a model-vendor SDK (only the adapters may)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(CORTEX_DIR)) {
      if (ADAPTER_FILES.has(file)) continue;
      const content = readFileSync(file, "utf8");
      if (FORBIDDEN_SPECIFIERS.some((spec) => content.includes(spec))) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
