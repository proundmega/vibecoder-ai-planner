# 03_ARCHITECT_IMPLEMENTATION.md - Test Audit Corrections (bp-123)

**Status:** implemented (PR #100, in review)
**Date:** 2026-10-31
**Baseline:** master `cc334a1` after PR #99

## Implementation summary

| Area | Files |
|---|---|
| Ticket assignee + owner | `backend/src/services/TicketService.js`, `backend/src/controllers/projectController.js` |
| User serialization | `backend/src/models/user.js`, user/auth routes |
| Lockout | `backend/src/middleware/auth.js`, `backend/src/api/routes.js` |
| Ticket model/serialization | `backend/src/models/ticket.js`, `backend/src/services/TicketService.js` |
| Critical priority | migration `044`, `backend/src/validators/*`, OpenAPI sources, frontend validator/generated types/modal |
| Dry-run | `backend/src/migrations/apply.js`, CLI tests, `backend/src/migrations/migrate.sql` |
| Windows agent | `agent/src/main/java/com/vibecode/agent/service/WorkspaceManager.java` + test |
| Cypress specs | `frontend/cypress/component/*.cy.ts` |
| Audit record | `AUDIT_REPORT.md` |

## Detailed changes

1. **Assignee**
   - `TicketService.update()` queries `project_memberships`.
   - The project owner bypasses the membership query.
   - `getProjectUsers()` filters users by membership or project ownership and excludes the current user.

2. **Password hash**
   - `User.toJSON()` removes `passwordHash`.
   - User serialization tests assert the field never appears.

3. **Lockout**
   - `Retry-After` is a finite integer derived from `lockedUntil`.
   - `clearFailedAttempts` is async and awaits Redis `del`.
   - Tests cover lockout and successful-login clearing.

4. **Ticket fields**
   - `fromRow()` keeps `assignee_name`/`project_name`.
   - `create()` returns `projectId`/`ownerId`.
   - Frontend detail/edit views use the same names.

5. **No-op status**
   - `Ticket.update()` skips validation when the status is unchanged.
   - The regression test uses the options-object signature from bp-122.

6. **Critical priority**
   - DB constraint, validators, OpenAPI, frontend validator, generated models/services and modal updated.
   - Contract tests accept `critical` and reject unknown values.

7. **Dry-run**
   - No `Pool` is created in dry-run.
   - Structural validation runs before classification.
   - The CLI test uses an invalid DB URL and asserts no connection errors.

8. **Windows**
   - POSIX calls are guarded; the POSIX-only test is skipped on non-POSIX filesystems.

## Test plan

- `npm test` (backend)
- `npm test -- --run` (frontend)
- `npm run lint` (backend/frontend)
- `npm run typecheck` (frontend)
- `mvn test` (agent)
- `npm run cypress:component` (if Chrome is available)
- `npm run db:migrate:dry-run` with an invalid `DATABASE_URL`

## Verification results

- Backend: 108 suites, 1,359/1,360 tests after rebasing on #99; the remaining failure was the stale positional `Ticket.update()` test, fixed in this revision.
- Frontend: 60 files / 551 tests, typecheck clean; Cypress component 63/63 verified by the reviewer.
- Backend/frontend lint: 0 errors.
- Java agent: package build succeeds; POSIX-only test skips on Windows.
- Dry-run: no DB connection, classification summaries printed, exit 0.

## Follow-ups

- `bp-124-audit-open-defects` for O1-O8.
- Move completed planning suites to `planning/DONE/`.
- Wire Cypress E2E into Jenkins.
