# 03 — Implementation (fg-44)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Measure current disk/inode growth per agent and per ticket
- [ ] Define per-agent workspace layout and TTL
- [ ] Add cleanup on ticket end, clean container stop and idle, only after a terminal run and lease release
- [ ] Preserve workspaces on unclean exit/active lease until the fg-33 reaper expires the lease
- [ ] Add a periodic `du`/inode budget meter that fails the ticket at the profile budget
- [ ] Define the 2-hour idle refresh policy and identity handling
- [ ] Add disk watermarks (warn/stop-spawn/cleanup/emergency)
- [ ] Add Docker log rotation and image cleanup
- [ ] Protect active tickets/leases from cleanup
- [ ] Add orphan workspace reaper and metrics
- [ ] Add tests for cleanup, refresh, watermarks and active-ticket safety
- [ ] Document manual recovery when the disk is full, using the pool pause endpoint and reaper

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-43, fg-33

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
| FR12 | | | | |
| FR13 | | | | |

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
