// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import type { Json } from "./event.js";
import { upcastToCurrent, currentVersion, UpcastError, type VersionRegistry } from "./upcasting.js";

// A synthetic three-version registry: it exercises the chaining mechanism
// without forcing a real evolution of a kernel event type.
const registry: VersionRegistry = {
  current: { Thing: 3 },
  upcasters: {
    Thing: {
      1: (p) => ({ ...p, v2: true }), // v1 -> v2: add a field
      2: (p) => {
        // v2 -> v3: rename `name` to `title`
        const { name, ...rest } = p as { name?: Json };
        return { ...rest, title: name ?? null };
      },
    },
  },
};

describe("upcastToCurrent", () => {
  it("applies the whole chain from an old version up to current", () => {
    const out = upcastToCurrent("Thing", 1, { name: "x" }, registry);
    expect(out).toEqual({ v2: true, title: "x" });
  });

  it("applies a partial chain from a middle version", () => {
    const out = upcastToCurrent("Thing", 2, { name: "y" }, registry);
    expect(out).toEqual({ title: "y" });
  });

  it("is a no-op when the event is already at the current version", () => {
    const payload = { title: "z" };
    expect(upcastToCurrent("Thing", 3, payload, registry)).toEqual(payload);
  });

  it("rejects an event whose version is newer than current (from the future)", () => {
    expect(() => upcastToCurrent("Thing", 4, {}, registry)).toThrow(UpcastError);
  });

  it("rejects an unknown event type", () => {
    expect(() => upcastToCurrent("Nope", 1, {}, registry)).toThrow(UpcastError);
  });

  it("rejects a gap with no upcaster registered", () => {
    const broken: VersionRegistry = { current: { Thing: 3 }, upcasters: { Thing: {} } };
    expect(() => upcastToCurrent("Thing", 1, {}, broken)).toThrow(UpcastError);
  });

  it("currentVersion returns the registered current, and throws for unknown types", () => {
    expect(currentVersion("Thing", registry)).toBe(3);
    expect(() => currentVersion("Nope", registry)).toThrow(UpcastError);
  });
});
