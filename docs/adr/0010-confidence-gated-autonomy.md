# ADR-0010: Confidence-gated autonomy (cross-cutting)

- **Status:** Accepted (provisional — revisit after the ADR-0006 vertical slice)
- **Date:** 2026-06-15
- **Decision owner:** elevenworks / MARROW
- **Depends on:** ADR-0001 (glass-box), ADR-0003 (events), ADR-0007 (the gate sits before outbox dispatch), ADR-0008 (corrections become precedent)

## Context

A founding invariant (VISION §3.3): **autonomous never means unsupervised.** The agent acts on its own *above* a tunable, per-action-type confidence threshold and *escalates* below it; human corrections in the grey zone flow back into memory. "An autonomous agent without confidence gates is a hallucination machine with an audit log — we are the opposite."

Research (2024–2026), honestly: **verbalized/self-reported confidence is theatre** for gating; what actually correlates with correctness is self-consistency, semantic entropy, and **post-hoc calibration**. RLHF tends to *degrade* calibration, so thresholds must be fit **empirically**, not hardcoded. The dominant real-world risk is **automation bias** (humans rubber-stamping the agent), and merely disclosing miscalibration to the human backfires.

## Decision

**Gate autonomy by action risk first, confidence second — and record the whole chain as events.**

- **"Confidence ≠ permission."** A 4-tier action taxonomy is the **floor**:
  - **T1 read-only** → autonomous.
  - **T2 reversible-internal** → autonomous + logged.
  - **T3 external / irreversible to third parties** (e.g. outbound email) → confidence gate / staging.
  - **T4 high-risk irreversible** (refunds, payments, deletes) → **human approval, no exceptions.**
  The tier sets the floor; confidence only modulates *within* a tier. A high-confidence T4 action is **still gated** — high confidence never buys past the tier.
- **Confidence from methods that correlate with correctness** (self-consistency, semantic entropy, post-hoc calibration), not verbalized self-report. **Cost-triage:** reserve N×-sampling for the grey zone and T3/T4; do not pay it on T1 reads.
- **Thresholds are per-action-type, tunable, fit empirically, and expressed as policy/data** — the natural-language operating procedures of the Language Center ("refunds over €X need a human") compile down to these gates.
- **Model the decision as events:** `DecisionProposed` → `ConfidenceAssessed` → `Acted` | `Escalated` → `HumanCorrected` → `OutcomeObserved{ wasCorrect, evidence }`. `OutcomeObserved` closes the **calibration loop**: folding `ConfidenceAssessed` + `OutcomeObserved` per action type derives the empirical calibration curve that tunes the thresholds. Human corrections become **retrievable precedent** (ADR-0008), not retraining.
- **The gate sits in front of side-effect dispatch** (ADR-0007's outbox): *escalate* = do not release the outbox; wait for a human decision (approve / edit / reject).

## Consequences

**Positive**

- Trustworthy, empirically-calibrated autonomy that is fully auditable and self-improving via precedent — the Immune System (§4) realized.
- Irreversible actions are structurally protected regardless of model overconfidence.

**Negative / costs we accept**

- Calibration infrastructure (sampling, ECE tracking, OutcomeObserved capture) to build; thresholds need real data to tune (cold-start is conservative by default).
- The Skin must be designed to resist automation bias (surface dissent, not just a green "approve").

## Alternatives considered

- **Gate on verbalized confidence only.** Rejected — it is miscalibrated theatre.
- **A single global confidence threshold without action tiers.** Rejected — high confidence would bypass irreversible actions; the tier floor is non-negotiable.
- **Learn from corrections by fine-tuning.** Rejected — VISION's learning is richer memory, not retraining (ADR-0008).

## Notes

Cross-cutting (the Immune System + the Language Center). Sources: Confidence Estimation/Calibration survey (NAACL 2024); Calibrating Verbalized Probabilities (2024); Risk-Controlled Refusal / selective prediction (2025); CSET *AI Safety and Automation Bias* (2024); semantic-entropy work; MindStudio four-tier action-risk framework.
