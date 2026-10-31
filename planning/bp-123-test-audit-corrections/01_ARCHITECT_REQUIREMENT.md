# 01_ARCHITECT_REQUIREMENT.md - Test Audit Corrections (bp-123)

**Status:** implemented (PR #100, in review)
**Date:** 2026-10-31
**Baseline:** master `cc334a1` after PR #99
**Report:** `AUDIT_REPORT.md`

## Problem

A full audit of the planner's backend, frontend and Java agent found defects that were invisible to the existing tests:

- ticket assignment validated against a non-existent `project_members` table;
- user APIs serialized the bcrypt `passwordHash`;
- failed-login responses returned `Retry-After: NaN`;
- ticket list/detail responses lost assignee/project names;
- ticket creation returned the wrong IDs;
- no-op status updates were rejected;
- the UI used `urgent` while the platform required `critical`;
- `db:migrate:dry-run` did not exist;
- the Java agent failed on Windows due to POSIX permission calls;
- several Cypress component specs were stale.

## Goals

1. Fix the audited product defects with regression tests.
2. Keep the changes minimal and behavior-compatible where possible.
3. Make the fixes testable without a live database (Jest mocks) and with integration tests where needed.
4. Add the missing `critical` priority end-to-end.
5. Implement a real dry-run that works without a database.
6. Record remaining open defects as follow-up tickets.

## Non-goals

- Rewriting the ticket phase system.
- Fixing every audit open defect (O1-O8) in this ticket; see `bp-124`.
- Adding Cypress E2E coverage to Jenkins.
- Reworking the frontend validator schema from snake_case to camelCase.

## Functional requirements

- **FR1 - Assignee:** validate against `project_memberships`; allow the project owner; reject non-members.
- **FR2 - Users API:** never return `passwordHash`; use `User.toJSON()`.
- **FR3 - Lockout:** return a numeric `Retry-After` (seconds) and no `NaN`.
- **FR4 - Ticket serialization:** preserve `assigneeName`/`projectName`; return camelCase `projectId`/`ownerId`.
- **FR5 - Ticket detail:** use the correct field names for status/priority/assignee in the UI.
- **FR6 - Status updates:** allow `status === current.status`; still reject invalid transitions.
- **FR7 - Priority:** add `critical` to the DB constraint, validators, OpenAPI, frontend validator, generated types, modal and contract test.
- **FR8 - Migration dry-run:** classify statements, print summaries, work with no DB, never apply changes, fail on structural errors.
- **FR9 - Agent:** guard POSIX permission calls on Windows.
- **FR10 - Cypress:** update stale component specs for the current UI.

## Safety requirements

- No password hashes or secrets in API responses.
- No migration executes during dry-run; no DB connection is attempted.
- Auth lockout responses remain generic and do not leak whether an account exists.
- The migration bootstrap path (`migrate.sql`) matches the latest priority constraint.
- Generated API types stay in sync with the OpenAPI spec.

## Acceptance criteria

1. Assignee validation uses `project_memberships` and covers owner/non-member cases.
2. `GET /users` and related endpoints never include `passwordHash`.
3. Lockout responses include a finite `Retry-After`.
4. Ticket list/detail/create responses use the expected camelCase fields.
5. No-op status updates succeed; invalid transitions fail.
6. `critical` is accepted by DB, validators, OpenAPI, frontend types and the edit modal.
7. `npm run db:migrate:dry-run` succeeds with an invalid `DATABASE_URL`, prints classification summaries, and does not print connection errors.
8. The Java agent tests pass on Windows (POSIX-only tests skip).
9. The backend and frontend suites pass; Cypress component specs are refreshed.
10. Remaining O1-O8 defects are tracked in `bp-124`.

## Out of scope

- O1 milestone field persistence.
- O2 dead SQL/missing tables.
- O3 E2E suite rewrite/Jenkins wiring.
- O4 agent identity semantics.
- O5 frontend validator camelCase migration.
- O6 PUT response type.
- O7 remaining docs drift.
- O8 integration setup error handling.

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | audit | Persist milestone fields | Backend | `bp-124-audit-open-defects` | No |
| 2 | audit | Remove dead SQL or add missing tables | Backend | `bp-124-audit-open-defects` | No |
| 3 | audit | Rewrite Cypress E2E and wire into Jenkins | Testing | `bp-124-audit-open-defects` | No |
| 4 | audit | Reconcile agent identity (`assigned_agent_id`) | Agent | `bp-124-audit-open-defects` | No |
| 5 | audit | Migrate frontend validator to camelCase | Frontend | `bp-124-audit-open-defects` | No |
| 6 | audit | Fix `PUT /tickets/:id` response type | Backend | `bp-124-audit-open-defects` | No |
| 7 | audit | Remaining docs drift | Docs | `bp-124-audit-open-defects` | No |
| 8 | audit | Integration setup should fail on migration errors | Testing | `bp-124-audit-open-defects` | No |
