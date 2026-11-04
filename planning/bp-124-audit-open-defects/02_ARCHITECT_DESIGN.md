# 02_ARCHITECT_DESIGN.md - Audit Open Defects (bp-124)

## Design summary

This is an umbrella ticket. Each defect gets its own implementation slice (and, when scheduled, its own `03`/`04`). The order is chosen to fix data/identity correctness before test and docs cleanup.

## O1 - Milestone fields

- Extend `Ticket.update()` to include `milestone_id`, `estimate`, `depends_on` in the SET clause.
- Wire `updateMilestoneFields()` to the milestone route or delete it if redundant.
- Add model/service/route tests and a UI contract test.
- Migration only if the columns are missing.

## O2 - Dead SQL / missing tables

- **Decision (2026-11-03):** delete the unused methods. No product flow needs `project_agents` or `audit_log` today, and adding tables would create unused schema and retention obligations.
- Decide per method: create `project_agents` / `audit_log` tables, or delete the unused methods.
- Prefer deletion for truly dead code; if audit logging is required, add a migration, indexes and rollback.
- Add a lint/test that prevents SQL against known-missing tables.

## O3 - Cypress E2E

- Replace hardcoded `alice@example.com` with API-seeded users.
- Use versioned `/api/v1` paths.
- Fix `.error` assertions to match the current UI.
- Add a Jenkins stage with a seeded backend/frontend stack.
- Component tests are tracked separately as **O9**, not folded into the E2E rewrite.

## O4 - Agent identity

- **Decision (2026-11-04):** `tickets.assigned_agent_id` references `agents(id)` and stores the agent id, not `agents.owner_id`.
- Migration `048_ticket_assigned_agent_fk.sql` drops the legacy `users(id)` FK, maps each stored owner user id to the oldest agent owned by that user (ambiguous owners use the lowest agent id), clears unmappable values, and adds the new FK with `ON DELETE SET NULL`. Rollback restores the `users(id)` FK.
- Pickup requires API-key agent credentials (`req.agent.id`); JWT callers receive 403 instead of storing a user id.
- Harness start/lease checks compare `assigned_agent_id` to `agents.id`.
- Update pickup/release/heartbeat/audit and tests.
- Preserve existing data where a mapping exists; provide a rollback.

## O5 - Validator camelCase

- Change Project/Ticket schemas to camelCase (`ownerId`, `projectId`).
- **Agent is the exception:** `AgentService.list()` returns raw DB rows, so its contract stays snake_case (`owner_id`). The old schema used a non-existent `user_id`, which is corrected to `owner_id`.
- Update callers/tests; keep backward-compatible aliases only if needed.
- Add a contract test against real API response shapes.

## O6 - PUT response type

- Either return the updated Ticket from `PUT /tickets/:id` or change `api/tickets.ts` to the actual shape.
- Prefer returning the Ticket for consistency with create.
- Update OpenAPI (including `dependsOn` as `string[]` and numeric-string BIGSERIAL ids). Regenerating the frontend client types is deferred per `00` D12.

## O7 - Docs drift

- Reconcile README CI text, migration counts, setup commands and planning statuses.
- Move completed suites to `planning/DONE/` and fill placeholders.
- Link `AUDIT_REPORT.md` to bp-123/bp-124.

## O8 - Integration setup errors

- `src/__tests__/integration/setup.js` should fail on unexpected migration errors, not warn.
- Allow an explicit ignore list for known idempotent "already exists" errors.
- Add a test that a broken migration fails the setup.

## O9 - Component tests

- Add `EditTicketModal.cy.ts` covering title/description limits, priority options, assignee selection/clearing and save payload.
- Replace the `TicketDetail.cy.ts` placeholder with real coverage for the detail/edit flow.
- Refresh `07-ticket-assignment.cy.ts` for the current DOM (do not use a generic `.modal select`).
- Verify the "Unassigned" path sends `assigneeId: null` and actually clears the assignment.
- Keep these component tests separate from the E2E suite (O3).

## O10 - Dry-run grammar validation

- Current dry-run does structural validation (balanced quotes/parentheses, non-empty statements).
- **Decision (2026-11-03):** keep structural validation and document the limitation. A real PostgreSQL parser is a new runtime dependency for a developer-only safeguard; the dry-run already refuses to open a database connection, so it cannot catch semantic errors regardless.
- The limitation is now stated in the `apply.js` dry-run help text and this suite.
- Do not reintroduce a database connection in dry-run.

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

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
