// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { InMemoryMark, type Mark } from "../../mark/index.js";
import { Cortex } from "./cortex.js";
import { FakeDecider } from "./decider.js";

/** Seed a complaint object directly on the Mark (perception reads it). */
async function seedComplaint(mark: Mark, text: string): Promise<string> {
  const id = "c1";
  await mark.append(id, { type: "ObjectCreated", id, objectType: "complaint" }, { metadata: { actor: "test" } });
  await mark.append(id, { type: "AttributeSet", key: "text", value: text }, { metadata: { actor: "test" } });
  return id;
}

describe("Cortex.run", () => {
  it("acts above the threshold: records the full chain and a draft intent", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "my order never arrived");
    const decider = new FakeDecider({ draft: "We're sorry…", confidence: 0.9 });

    const episode = await new Cortex(mark, decider, { threshold: 0.8 }).run(id);

    expect(episode.status).toBe("acted");
    expect(episode.draft).toBe("We're sorry…");
    expect(episode.confidence).toBe(0.9);
    expect(episode.perceivedSeq).toBe(2);

    const history = await mark.read(id);
    expect(history.map((h) => h.event.type)).toEqual([
      "ObjectCreated",
      "AttributeSet",
      "DecisionProposed",
      "ConfidenceAssessed",
      "Acted",
    ]);

    // The chain shares one correlationId (the episode) — glass-box "why".
    const chain = history.filter((h) =>
      ["DecisionProposed", "ConfidenceAssessed", "Acted"].includes(h.event.type),
    );
    expect(new Set(chain.map((h) => h.correlationId)).size).toBe(1);

    // Acted releases exactly the proposed draft — a recorded intent, nothing dispatched.
    const proposed = history.find((h) => h.event.type === "DecisionProposed");
    const acted = history.find((h) => h.event.type === "Acted");
    expect(proposed).toBeDefined();
    expect(acted?.event).toEqual({ type: "Acted", draftRef: proposed!.eventId });
  });

  it("escalates below the threshold: no draft released", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "unhappy");
    const decider = new FakeDecider({ draft: "draft", confidence: 0.4 });

    const episode = await new Cortex(mark, decider, { threshold: 0.8 }).run(id);

    expect(episode.status).toBe("escalated");
    expect(episode.draft).toBeNull();

    const history = await mark.read(id);
    expect(history.at(-1)?.event.type).toBe("Escalated");
  });

  it("is idempotent: a second run does not re-roll the model or duplicate the chain", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "again");
    const decider = new FakeDecider({ draft: "draft", confidence: 0.9 });
    const cortex = new Cortex(mark, decider, { threshold: 0.8 });

    await cortex.run(id);
    const lengthAfterFirst = (await mark.read(id)).length;
    await cortex.run(id);
    const lengthAfterSecond = (await mark.read(id)).length;

    expect(lengthAfterSecond).toBe(lengthAfterFirst);
    expect(decider.calls).toBe(1);
  });

  it("keeps ObjectState field-clean: version counts decision events, no decision field", async () => {
    const mark = new InMemoryMark();
    const id = await seedComplaint(mark, "x");
    await new Cortex(mark, new FakeDecider({ draft: "d", confidence: 0.9 })).run(id);

    const state = await mark.load(id);
    const events = await mark.read(id);
    expect(state?.version).toBe(events.length);
    expect(state && "decision" in state).toBe(false);
  });

  it("refuses to perceive an object that does not exist", async () => {
    const mark = new InMemoryMark();
    const cortex = new Cortex(mark, new FakeDecider({ draft: "d", confidence: 0.9 }));
    await expect(cortex.run("ghost")).rejects.toThrow();
  });
});
