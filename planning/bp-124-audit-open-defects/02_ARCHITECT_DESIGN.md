# 02_ARCHITECT_DESIGN.md - Audit Open Defects (bp-124)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** bp-123

## Design summary

This is an umbrella ticket. Each defect gets its own implementation slice (and, when scheduled, its own `03`/`04`). The order is chosen to fix data/identity correctness before test and docs cleanup.

## O1 - Milestone fields

- Extend `Ticket.update()` to include `milestone_id`, `estimate`, `depends_on` in the SET clause.
- Wire `updateMilestoneFields()` to the milestone route or delete it if redundant.
- Add model/service/route tests and a UI contract test.
- Migration only if the columns are missing.

## O2 - Dead SQL / missing tables

- Decide per method: create `project_agents` / `audit_log` tables, or delete the unused methods.
- Prefer deletion for truly dead code; if audit logging is required, add a migration, indexes and rollback.
- Add a lint/test that prevents SQL against known-missing tables.

## O3 - Cypress E2E

- Replace hardcoded `alice@example.com` with API-seeded users.
- Use versioned `/api/v1` paths.
- Fix `.error` assertions to match the current UI.
- Add a Jenkins stage with a seeded backend/frontend stack.
- Keep component tests separate.

## O4 - Agent identity

- Current `assigned_agent_id` references `users(id)` and stores the owner user id.
- Decide: add `agents.id` FK or store `agent_id` with a clear name.
- Migration + backfill from existing agents/users.
- Update pickup/release/heartbeat/audit and tests.
- Preserve existing data; provide a rollback.

## O5 - Validator camelCase

- Change Project/Ticket/Agent schemas to camelCase (`ownerId`, `projectId`, `userId`).
- Update callers/tests; keep backward-compatible aliases only if needed.
- Add a contract test against real API response shapes.

## O6 - PUT response type

- Either return the updated Ticket from `PUT /tickets/:id` or change `api/tickets.ts` to the actual shape.
- Prefer returning the Ticket for consistency with create.
- Update OpenAPI and generated types.

## O7 - Docs drift

- Reconcile README CI text, migration counts, setup commands and planning statuses.
- Move completed suites to `planning/DONE/` and fill placeholders.
- Link `AUDIT_REPORT.md` to bp-123/bp-124.

## O8 - Integration setup errors

- `src/__tests__/integration/setup.js` should fail on unexpected migration errors, not warn.
- Allow an explicit ignore list for known idempotent "already exists" errors.
- Add a test that a broken migration fails the setup.

## Rollout

1. O1/O2 (data correctness, low risk).
2. O4 (identity migration, requires backfill).
3. O3/O8 (test trust).
4. O5/O6 (contract cleanup).
5. O7 and planning/DONE.

## Open questions

1. Does the product need milestone writes, or should the UI be read-only?
2. Is agent identity a new FK or a rename of `assigned_agent_id`?
3. Do we keep Cypress or move component tests to Vitest browser mode?
4. Should `PUT /tickets/:id` return the ticket or a message?
5. How much backward compatibility is needed for the validator?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | bp-123 | O1-O8 umbrella | Multiple | `bp-124-audit-open-defects` | No |
| 2 | bp-79 | Full SQL grammar validation | Backend | `bp-124-audit-open-defects` | No |
| 3 | fg-30 | Harness roadmap | Agent | `fg-33`+ | No |
