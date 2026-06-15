// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { InMemoryMark } from "../../mark/index.js";
import { Cortex } from "./cortex.js";
import { FakeDecider } from "./decider.js";
import { readObjectWithDecision } from "./read.js";

describe("readObjectWithDecision", () => {
  it("merges field-clean state with the decision episode", async () => {
    const mark = new InMemoryMark();
    const id = "c1";
    await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "test" } });
    await mark.append(id, { type: "AttributeSet", key: "text", value: "late" }, { metadata: { actor: "test" } });
    await new Cortex(mark, new FakeDecider({ draft: "Sorry", confidence: 0.9 })).run(id);

    const merged = await readObjectWithDecision(mark, id);

    expect(merged?.state.attributes).toEqual({ text: "late" });
    expect(merged?.state && "decision" in merged.state).toBe(false);
    expect(merged?.decision?.status).toBe("acted");
    expect(merged?.decision?.draft).toBe("Sorry");
  });

  it("returns null for an unknown object", async () => {
    expect(await readObjectWithDecision(new InMemoryMark(), "nope")).toBeNull();
  });
});
