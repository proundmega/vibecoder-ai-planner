# 03 — Implementation (fg-42)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Define data classification (public/internal/confidential/secret)
- [ ] Add pre-flight redaction and secret scanning
- [ ] Add post-flight output scanning
- [ ] Define provider allowlist and retention policy per project
- [ ] Enforce tenant/project isolation in prompts, logs and artifacts
- [ ] Define retention/deletion for run data
- [ ] Add local-model option for sensitive repos
- [ ] Add audit and consent/recording controls
- [ ] Test secrets, PII, tenant isolation and provider policy

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-30, fg-34, fg-41

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
