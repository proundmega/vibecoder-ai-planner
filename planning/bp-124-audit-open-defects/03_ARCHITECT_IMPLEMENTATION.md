# 03 — Implementation (bp-124)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Triage O1-O8 and assign priorities/owners
- [ ] Create per-defect planning suites when scheduled
- [ ] Fix O1 milestone field persistence
- [ ] Fix O2 dead SQL / missing tables
- [ ] Rewrite and wire Cypress E2E (O3)
- [ ] Reconcile agent identity semantics (O4)
- [ ] Migrate frontend validator to camelCase (O5)
- [ ] Fix `PUT /tickets/:id` response type (O6)
- [ ] Finish docs drift cleanup (O7)
- [ ] Make integration setup fail on migration errors (O8)
- [ ] Add EditTicketModal/TicketDetail component tests and refresh assignment E2E (O9)
- [ ] Decide on full SQL grammar validation for dry-run (O10)
- [ ] Move completed planning suites to `planning/DONE/`

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- bp-123

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
| FR11 | | | | |

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
