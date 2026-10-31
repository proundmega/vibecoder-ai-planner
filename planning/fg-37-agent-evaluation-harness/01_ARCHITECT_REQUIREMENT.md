# 01_ARCHITECT_REQUIREMENT.md - Agent Evaluation Harness (fg-37)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31 reviewer, fg-32 fixer loop
**Related code:** harness supervisor, OpenCode config, CI

## Problem

The harness can be tuned through prompts, models, config permissions, verification commands and budgets. None of those changes are measured. Current evidence is anecdotal or a one-off benchmark:

- no fixed task corpus;
- no reproducible repos/commits;
- no objective pass/fail grading;
- no cost/latency/token metrics;
- no reviewer-quality measurement;
- no regression gate when changing a prompt or model;
- no adversarial/security suite.

Without measurement, "autonomy" is guesswork and model swaps are risky.

## Goals

1. Provide a repeatable evaluation corpus with pinned repos, commits and expected outcomes.
2. Grade outcomes objectively: tests, diff constraints, required files, forbidden changes.
3. Measure quality, cost and time per task/model/config.
4. Compare models and prompts (A/B) with statistical honesty.
5. Calibrate the reviewer against human labels.
6. Include security/adversarial cases.
7. Run nightly and on PRs that change harness behavior.
8. Publish results that humans can inspect.

## Non-goals

- Replacing unit/integration tests for the planner itself.
- Public leaderboard/SWE-bench parity.
- Evaluating arbitrary prompts outside the harness.
- Human-free approval of production changes.

## Functional requirements

- **FR1 - Corpus:** task manifests with repo URL, pinned base SHA, ticket text, setup commands, verification commands and expected outcomes.
- **FR2 - Isolation:** each evaluation run uses a fresh workspace/sandbox and a fresh model context.
- **FR3 - Grading:** objective checks first (tests, build, lint, file presence/absence, diff constraints); optional LLM judge only as a secondary signal.
- **FR4 - Metrics:** pass rate, verification pass rate, tests added, diff size, files touched, time, tokens, cost, review rounds, human acceptance.
- **FR5 - A/B:** run the same corpus against two models/prompts/configs; report per-task deltas and confidence.
- **FR6 - Reviewer calibration:** compare reviewer verdicts/findings with human labels on a sample; track precision/recall.
- **FR7 - Security cases:** prompt injection, secret access, malicious tests, protected-path edits, destructive commands; pass only if the guard blocks them.
- **FR8 - Regression gate:** fail CI if pass rate or cost regresses beyond configured thresholds.
- **FR9 - Storage:** persist run results, per-task logs, diffs and metrics.
- **FR10 - Reporting:** a human-readable report per run and a trend view.

## Safety requirements

- Evaluation repos/scripts are untrusted; run them in the sandbox (fg-34).
- Do not use production credentials or real customer repos.
- Graders must not be fooled by the agent editing tests to pass; verify test integrity (expected test files/hashes or independent tests).
- Cost caps per eval run; abort on budget breach.
- Results must redact secrets.

## Acceptance criteria

1. A single command runs the corpus against a model/config and produces a report.
2. Every task has a pinned base SHA and deterministic setup/verification.
3. The report includes pass rate, cost, tokens, time and review rounds.
4. A model/prompt change can be compared against the baseline.
5. Reviewer calibration metrics are reported on a labeled sample.
6. Adversarial tasks verify the guard blocks them.
7. Nightly runs and harness-changing PRs are gated.
8. Results are stored and browsable.

## Out of scope

- Public benchmark publication.
- Training/fine-tuning models.
- Human preference labeling at scale.
- Evaluating non-coding agents.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-38 | Budget-aware evaluation runs | Billing | `fg-38-harness-budgets-routing` | No |
| 2 | fg-34 | Sandboxed evaluation repos | Security | `fg-34-harness-sandbox` | No |
| 3 | fg-41 | Eval result dashboards | Observability | `fg-41-harness-observability` | No |
| 4 | bp-99 | E2E UI for eval reports | Testing | `bp-99` follow-up | No |
