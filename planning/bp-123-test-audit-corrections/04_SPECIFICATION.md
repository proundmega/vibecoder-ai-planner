# 04_SPECIFICATION.md - Test Audit Corrections (bp-123)

**Status:** implemented (PR #100, in review)
**Date:** 2026-10-31
**Baseline:** master `cc334a1` after PR #99

This is the implemented contract for the audit corrections. It records the behavior the regression tests must protect.

## Slice 1 - Assignee validation

- `TicketService.update(id, { assigneeId })`:
  - rejects an unknown user with `Assignee not found`;
  - allows the project owner;
  - rejects a user without a `project_memberships` row with `Assignee is not a member of this project`;
  - never references `project_members`.
- `GET /projects/:id/users` returns the project owner and members, excluding the current user.

## Slice 2 - User serialization

- `User.toJSON()` must not contain `passwordHash`.
- `GET /users`, `GET /users/:id`, auth responses and agent user responses use the safe shape.

## Slice 3 - Lockout

- Failed login after the threshold returns HTTP 429.
- `Retry-After` is a finite integer >= 0.
- Successful login clears the counter asynchronously and eventually removes the Redis key.

## Slice 4 - Ticket serialization

- `Ticket.fromRow()` maps `assignee_name` -> `assigneeName`, `project_name` -> `projectName`.
- `Ticket.create()` returns `projectId` and `ownerId`.
- Ticket detail/create responses use camelCase fields.

## Slice 5 - Status updates

- `Ticket.update(id, { title, status: currentStatus })` succeeds and includes `title`/`status` in the SET clause.
- `Ticket.update(id, { status: 'done' })` from `backlog` throws `Invalid status transition from backlog to done`.
- `Ticket.update` uses the options-object signature and ignores undefined fields.

## Slice 6 - Critical priority

- DB migration 044 allows `low, medium, high, critical, urgent`; rollback restores the old set.
- Backend validators, OpenAPI, frontend validator, generated types and `TicketEditModal.vue` all include `critical`.
- `migrationPrioritySync.test.js` and `api-contract.test.ts` protect the contract.

## Slice 7 - Migration dry-run

- `npm run db:migrate:dry-run`:
  - prints `DRY-RUN MODE`;
  - classifies every statement;
  - prints per-file and total summaries;
  - prints `[DRY-RUN] Would run data migration` for JS migrations;
  - does not create a `Pool`, connect, or execute SQL;
  - exits 0 for valid files, non-zero for structural errors;
  - does not print `Error in`/`ECONNREFUSED` when `DATABASE_URL` is invalid.
- Normal migration mode:
  - connects once;
  - exits non-zero on connection failure;
  - executes statements and data migrations in array order.

## Slice 8 - Windows agent

- `WorkspaceManager.createCredentialHelper()` only calls `setPosixFilePermissions` when the filesystem supports POSIX attributes.
- The POSIX-only test skips on Windows.

## Test commands

```bash
cd backend && npm test
cd frontend && npm test -- --run
cd frontend && npm run typecheck
cd backend && npm run lint
cd frontend && npm run lint
cd agent && mvn test
DATABASE_URL=postgresql://invalid:invalid@127.0.0.1:1/none npm run db:migrate:dry-run
```
