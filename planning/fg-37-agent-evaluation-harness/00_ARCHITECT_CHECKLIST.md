# 00_ARCHITECT_CHECKLIST.md - Agent Evaluation Harness (fg-37)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1, fg-31 reviewer, fg-32 fixer loop
**Related code:** agent harness, `planning/`, CI

## Why this ticket exists

We cannot currently answer "is the agent getting better?" in a repeatable way. The Beam/Iceman comparison was a one-off benchmark, not a regression suite. There is no golden task set, no quality metrics, no reviewer calibration and no gate for prompt/model/config changes.

## Checklist

- [ ] Define the evaluation corpus and task manifest format
- [ ] Define objective graders (tests, diff constraints, file checks)
- [ ] Define quality metrics and thresholds
- [ ] Add model/prompt/config A/B comparison support
- [ ] Add reviewer calibration against human labels
- [ ] Add security/adversarial cases (prompt injection, secrets, bad tests)
- [ ] Run nightly and on harness-changing PRs
- [ ] Store results and publish a dashboard/report
- [ ] Decide which model changes require an evaluation gate
