// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 elevenworks

import { describe, it, expect } from "vitest";
import { InMemoryMark } from "../../mark/index.js";
import { MarkService } from "./service.js";

describe("MarkService", () => {
  it("creates an object with attributes and reads it back", async () => {
    const svc = new MarkService(new InMemoryMark());
    const created = await svc.createObject("ticket", { subject: "Burst pipe", priority: "high" });

    expect(created.objectType).toBe("ticket");
    expect(created.attributes).toEqual({ subject: "Burst pipe", priority: "high" });
    expect(await svc.getObject(created.id)).toEqual(created);
  });

  it("mutates state, attributes and notes through the kernel", async () => {
    const svc = new MarkService(new InMemoryMark());
    const o = await svc.createObject("ticket");

    await svc.changeState(o.id, "open");
    await svc.setAttribute(o.id, "priority", "high");
    await svc.addNote(o.id, "dispatched on-call tech");

    const s = await svc.getObject(o.id);
    expect(s?.state).toBe("open");
    expect(s?.attributes).toEqual({ priority: "high" });
    expect(s?.notes).toEqual(["dispatched on-call tech"]);
  });

  it("records glass-box history stamped with the caller as actor", async () => {
    const svc = new MarkService(new InMemoryMark(), "mcp:claude");
    const o = await svc.createObject("ticket");

    const history = await svc.getHistory(o.id);
    expect(history[0]?.event.type).toBe("ObjectCreated");
    expect(history.every((e) => e.metadata.actor === "mcp:claude")).toBe(true);
  });

  it("lists objects of a type", async () => {
    const svc = new MarkService(new InMemoryMark());
    await svc.createObject("ticket");
    await svc.createObject("invoice");
    await svc.createObject("ticket");

    expect(await svc.listObjects("ticket")).toHaveLength(2);
    expect(await svc.listObjects("invoice")).toHaveLength(1);
  });

  it("getObject returns null for an unknown id", async () => {
    const svc = new MarkService(new InMemoryMark());
    expect(await svc.getObject("nope")).toBeNull();
  });

  it("rejects mutating an object that does not exist", async () => {
    const svc = new MarkService(new InMemoryMark());
    await expect(svc.changeState("ghost", "open")).rejects.toThrow();
  });
});
