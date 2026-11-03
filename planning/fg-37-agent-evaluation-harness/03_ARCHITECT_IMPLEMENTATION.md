# 03 — Implementation (fg-37)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Define the evaluation corpus and task manifest format
- [ ] Define objective graders (tests, diff constraints, file checks)
- [ ] Define quality metrics and thresholds
- [ ] Add model/prompt/config A/B comparison support
- [ ] Add reviewer calibration against human labels
- [ ] Add security/adversarial cases (prompt injection, secrets, bad tests)
- [ ] Run nightly and on harness-changing PRs
- [ ] Store results and publish a dashboard/report
- [ ] Decide which model changes require an evaluation gate

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-30, fg-31, fg-32

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | | | | |
| FR2 | | | | |
| FR3 | | | | |
| FR4 | | | | |
| FR5 | | | | |
| FR6 | | | | |
| FR7 | | | | |
| FR8 | | | | |
| FR9 | | | | |
| FR10 | | | | |

## Review checklist

- [ ] Every `FR*`/`NFR*` has a passing row in the matrix
- [ ] Error paths and edge cases are covered, not only the happy path
- [ ] Migration has a rollback and is registered in `apply.js`
- [ ] API contract matches `02`; OpenAPI/types regenerated if it changed
- [ ] No secret, `.env`, `Jenkinsfile`, or unrelated file touched
- [ ] `04` (if present) matches what was actually built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| | | | |
