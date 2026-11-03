# 03 — Implementation (fg-45)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [ ] Define the Definition of Ready (DoR) and the small-fix exemption
- [ ] Enumerate every path into `in_progress` (pickup, status route, PUT, phase transitions, planning status)
- [ ] Centralize `assertReadyForExecution` and call it from all five paths
- [ ] Keep ticket creation permissive: title-only tickets are drafts
- [ ] Reject `planning_status=completed` outside the readiness service; reject transitions out of `completed` (`REPLAN_REQUIRED`) and add the audited `replan` path
- [ ] Add `ticket_acceptance_criteria` and per-template `requiredSections`
- [ ] Add readiness columns (`plan_approved_*`, `ready_*`, `small_fix_*`, waiver fields, grandfathered)
- [ ] Add issue codes and `ReadinessError` (409 `READINESS_FAILED` with `details.issues`)
- [ ] Honor `READINESS_GATE_MODE=off|warn|enforce` (default `warn`) in the assertion
- [ ] Refresh `ready_at` on every readiness-relevant write and on waiver expiry
- [ ] Extend the Java error model and handle readiness in both processors
- [ ] Add `TICKET_READINESS_APPROVE`/`TICKET_READINESS_OVERRIDE` permissions with project membership
- [ ] Add `assertProjectMember` (owner, `project_memberships`, agent owner, `super_admin` bypass)
- [ ] Add `ticket_readiness_events` audit with `actor_type`/agent IDs, out-of-band blocked rows, and revocation/expiry events (do not depend on the missing `audit_log`)
- [ ] Scope overrides to waived codes + expiry; keep small-fix separate
- [ ] Backfill/grandfather existing tickets (approval + ready + completed)
- [ ] Propagate readiness errors in `frontend/src/api/tickets.ts`
- [ ] Add the ticket creation wizard and readiness panel
- [ ] Add readiness metrics and blocked-ticket messages
- [ ] Add tests for every write path, both agent modes, override and UI

## Per-file changes

To be filled in when implementation starts.

| File | Action | Change |
|---|---|---|
| | | |

## Dependencies

- fg-30, fg-31

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
| FR14 | | | | |
| FR15 | | | | |
| FR16 | | | | |

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
