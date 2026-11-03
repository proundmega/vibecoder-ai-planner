# 03 — Implementation (fg-35)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Create/register the GitHub App and define required permissions
- [ ] Define installation-per-project mapping and repo allowlist
- [ ] Implement token minting, caching and expiry handling
- [ ] Use the token without persisting it in the workspace or process args
- [ ] Add rotation/revocation and audit events
- [ ] Add a dev-only PAT fallback behind a flag
- [ ] Add tests for expiry, scope, leakage and multi-repo isolation
- [ ] Document GitHub Enterprise support and migration from PATs

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-30

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
