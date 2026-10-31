# 02_ARCHITECT_DESIGN.md - Test Audit Corrections (bp-123)

**Status:** implemented (PR #100, in review)
**Date:** 2026-10-31
**Baseline:** master `cc334a1` after PR #99

## Design summary

The audit fixes are intentionally small and localized. Each fix has a regression test at the layer where the bug lived.

## Key decisions

### Assignee validation

- Use `project_memberships`, the table that actually exists.
- Allow the project owner even without a membership row.
- Filter `GET /projects/:id/users` to members + owner so the picker cannot offer invalid assignees.

### User serialization

- Add `User.toJSON()` that strips `passwordHash` (and any other sensitive fields).
- Use it in user APIs and auth responses.

### Lockout Retry-After

- Compute remaining lockout seconds as a finite integer.
- Never derive `Retry-After` from `NaN`.
- Make `clearFailedAttempts` async and await the Redis `del` so successful login ordering is deterministic.

### Ticket serialization

- `Ticket.fromRow()` maps `assignee_name`/`project_name` into camelCase names.
- `Ticket.create()` returns `projectId`/`ownerId`.
- Ticket detail uses the same field names as the API.

### No-op status updates

- `Ticket.update()` skips transition validation when `status === current.status`.
- Invalid transitions still throw `Invalid status transition from X to Y`.
- The model accepts an options object after bp-122; tests use that signature.

### Critical priority

- Migration `044_allow_critical_priority.sql` widens the constraint; rollback restores the old set.
- Update `validators/tickets.js`, `validators/agents.js`, OpenAPI sources, `frontend/api/validator.ts`, generated models/services, and `TicketEditModal.vue`.
- `migrationPrioritySync.test.js` guards the backend/OpenAPI/frontend contract.
- `api-contract.test.ts` accepts `critical` and rejects unknown priorities.

### Migration dry-run

- Read and split SQL before any database connection.
- Dry-run: classify statements, print per-file summaries, run structural validation (balanced quotes/parentheses, non-empty statements), never create a `Pool`.
- Normal mode: create one pool, verify the connection once, fail fast with exit code 1 if it fails, then run each file.
- Data migrations are only reported in dry-run.
- The CLI test uses an invalid `DATABASE_URL` and asserts no `Error in`/`ECONNREFUSED` and that summaries are printed.

### Windows POSIX guard

- Check `FileSystems.getDefault().supportedFileAttributeViews().contains("posix")` before `setPosixFilePermissions`.
- The POSIX-only permission test is skipped on Windows.

## Migration ordering

`044_allow_critical_priority.sql` and its rollback are appended to `SQL_FILES` in `apply.js` (array order, not numeric). The manual bootstrap `migrate.sql` includes `critical` as well.

## Failure handling

- Dry-run structural errors set `process.exitCode = 1` and print `[INVALID]` per statement.
- Normal migration connection failure prints one clear error and exits non-zero.
- Statement-level "already exists" errors keep the existing tolerant behavior for idempotent migrations.
- Assignee validation failures return a 400 with a clear message.

## Tests

- `ticketModelRegressions.test.js` (object signature, no-op status, invalid transition)
- `ticketServiceAssignee.test.js` (membership, owner, non-member)
- `projectControllerUsers.test.js` (members + owner query)
- `migrationDryRun.test.js` / `migrationDryRunCli.test.js` (classification, structural validation, no DB)
- `migrationPrioritySync.test.js` (DB/validators/OpenAPI/frontend)
- `userModelSerialization.test.js` (no password hash)
- `authLockoutRetryAfter.test.js` / `rateLimiter.test.js` (finite Retry-After, async clear)
- `ticketServiceGetOne.test.js`, `templateRefAccess.test.ts`, refreshed Cypress specs

## Rollout

1. Merge after CI and a rebase on current master.
2. Run the backend suite, frontend suite, lint, typecheck and agent tests.
3. Keep `bp-124` for the remaining audit defects; do not mark the audit fully closed until those are triaged.

## Open questions

1. Should the assignee picker include the current user? (Current behavior excludes them; unchanged.)
2. Should dry-run grow a full SQL parser later?
3. Should the frontend validator move to camelCase in bp-124?
4. Should the audit report move under `planning/` or stay at the repo root with this suite as the ticket?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | audit | O1-O8 open defects | Multiple | `bp-124-audit-open-defects` | No |
| 2 | audit | Move completed suites to `planning/DONE/` | Docs | `bp-124-audit-open-defects` | No |
| 3 | bp-79 | Full SQL grammar validation | Backend | `bp-124-audit-open-defects` | No |
