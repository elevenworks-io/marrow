# MARROW

**The sovereign, agent-native back-office that resolves your work itself — and remembers all of it.**

> Working title. Building in public from the foundation up.

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-AGPL_v3-blue.svg" alt="License: AGPL v3"></a>
  <a href="https://cla-assistant.io/elevenworks-io/marrow"><img src="https://cla-assistant.io/readme/badge/elevenworks-io/marrow" alt="CLA assistant"></a>
  <a href="#status"><img src="https://img.shields.io/badge/status-foundational-orange.svg" alt="Status: Foundational"></a>
  <a href="#what-makes-it-different"><img src="https://img.shields.io/badge/sovereign-EU%20%2F%20self--hostable-003399.svg" alt="Sovereign: EU / self-hostable"></a>
  <a href="CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
  <a href="https://www.conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional_Commits-1.0.0-yellow.svg" alt="Conventional Commits"></a>
  <a href="https://github.com/elevenworks-io/marrow/stargazers"><img src="https://img.shields.io/github/stars/elevenworks-io/marrow?style=flat&amp;logo=github" alt="GitHub stars"></a>
  <a href="https://github.com/elevenworks-io/marrow/commits/main"><img src="https://img.shields.io/github/last-commit/elevenworks-io/marrow" alt="Last commit"></a>
</p>

---

A helpdesk ticket is an object with attributes that moves through states, driven by rules, fed by channels, remembered forever. So is an invoice. So is a contract, a lead, an incident, a dispatch, a compliance review. **They are all the same shape.**

The industry built a separate application for each — CRM, DMS, ITSM, AP automation, HR — and then bolted a chatbot onto every silo. MARROW does the opposite: **one substrate that *becomes* any of these** by changing its schema and its workflows, with an **autonomous agent** running on top that senses incoming work, reasons about it, acts to resolve it, remembers everything, and gets sharper every night — while being able to **prove every decision it ever made**.

The category isn't "ticketing." It's **Autonomous Operations**.

## What makes it different

Three things the global cloud incumbents structurally can't offer:

- **Glass-box.** Every autonomous action is reconstructable from the system's own memory — the standing answer to "explain this decision." Nothing is a black box, because nothing is ever thrown away.
- **Learns over night.** Every resolved case becomes retrievable precedent. The system improves because its memory grows richer — no retraining. Tomorrow it's better than today, by construction.
- **Sovereign by default.** Data *and* inference run in the EU or on your own infrastructure. Self-hostable isn't a future enterprise tier; it's the spine.

The architecture that makes all of this possible is a single decision: **an append-only event log is the source of truth.** State, memory, audit trail, simulation, and the learning signal are one substrate, not five systems. See [`docs/adr/0001-event-sourced-substrate.md`](docs/adr/0001-event-sourced-substrate.md).

## Status

**Foundational.** This repository is at the very beginning — we're laying the spine before the organs. Expect the substrate (the event-sourced core) and decision records first; capabilities grow on top of it over the coming months. Built in the open, with the reasoning published as we go.

## Follow along

- ⭐ **Watch / Star** to follow the build.
- 💬 **Discussions** for the thinking, the open questions, and the architecture debates.
- 📓 The decision log lives in [`docs/adr/`](docs/adr/) — each record doubles as a build-log entry.

## The documents

| File | What it is |
|---|---|
| [`VISION.md`](VISION.md) | The permanent target. The finished organism, described as if it already exists — including how it *feels* to use. Read this first. |
| [`docs/adr/`](docs/adr/) | The decision log. Time-bound architectural choices and their reasoning. |
| [`CLAUDE.md`](CLAUDE.md) | Operating context for AI coding agents working in this repo. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to get involved and how decisions are made. |

## License

AGPL-3.0 — open to read, run, and self-host; modifications shared back. See [`LICENSE`](LICENSE). For commercial terms without the AGPL obligations, get in touch.

---

*This README is the door. [`VISION.md`](VISION.md) is the room.*