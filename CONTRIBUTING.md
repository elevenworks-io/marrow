# Contributing to MARROW

MARROW is built in the open. Thinking, decisions, and reasoning are public on purpose — the build log *is* part of the product.

This is an early, foundational project. The most valuable contributions right now are sharp questions, architectural critique, and pressure-testing the thesis — not large feature PRs against a substrate that is still being laid.

## Before you build

1. **Read [`VISION.md`](VISION.md).** It is the target.
1. **The invariants in VISION.md §3 are law.** Any change that violates one is out of scope unless it comes with an ADR proposing to change the invariant itself (a high bar).
1. **Read [`CLAUDE.md`](CLAUDE.md)** for how work is done in this repo — it applies to humans and AI agents alike.

## How decisions are made

Architectural choices are recorded as **ADRs** in [`docs/adr/`](docs/adr/), numbered and dated. If you want to propose a direction (a stack, a pattern, a boundary), open an issue or a Discussion first, and if it’s adopted, capture it as an ADR. Decisions live in records, not in buried commit messages.

The founding decisions are settled — ADR-0001 (the event-sourced substrate) and ADR-0002 (the stack: TypeScript on Node + PostgreSQL). The Spine kernel, Layer 1, and the first organ (the Mark over MCP) are built. What's decided, what's still open, and what real use has taught lives in [`docs/mark-capability-map.md`](docs/mark-capability-map.md) — start there to see where things stand.

## Workflow

- Open an **issue** or **Discussion** before non-trivial work so we can align on direction.
- Keep changes **small and verifiable**. For the spine kernel especially, prove projection/replay behavior with tests before building upward.
- Branch, commit, open a PR. Reference the issue/ADR it relates to.

## Commit & PR conventions

- Conventional, scoped commits: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- One logical change per PR where possible. Explain the *why*, link the relevant ADR or issue.

## Contributor License Agreement

Contributions require signing the **MARROW Individual Contributor License Agreement** ([`CLA.md`](CLA.md)). The first time you open a pull request, the CLA-assistant bot asks you to sign — a one-time confirmation in the PR thread. This is what lets MARROW be offered under both its open-source license (AGPL-3.0) and a commercial license.

## Conduct

Be decent. We follow the [Contributor Covenant](CODE_OF_CONDUCT.md). Disagreement is welcome; disrespect isn't.

## License

MARROW is licensed under AGPL-3.0 ([`LICENSE`](LICENSE)); see [`LICENSING.md`](LICENSING.md) for the open-source + commercial model. Your contribution terms are governed by the CLA above.