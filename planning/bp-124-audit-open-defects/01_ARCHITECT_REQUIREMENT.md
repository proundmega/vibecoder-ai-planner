# 01_ARCHITECT_REQUIREMENT.md - Audit Open Defects (bp-124)

**Status:** planned
**Date:** 2026-10-31
**Source:** `AUDIT_REPORT.md` O1-O8
**Depends on:** bp-123

## Problem

`AUDIT_REPORT.md` lists eight known defects that PR #100 did not fix. They are currently only prose in the report; they have no tickets, priorities or acceptance criteria. Several affect production behavior or developer confidence.

## Defects

| ID | Priority | Defect | Impact |
|---|---|---|---|
| O1 | Medium | Milestone fields cannot be persisted | `ProjectMilestones.vue` displays values no API can write |
| O2 | Medium | Dead SQL references missing tables (`project_agents`, `audit_log`) | Latent 500s if the methods are called |
| O3 | Medium | Cypress E2E is stale and not in CI | UI regressions go unnoticed |
| O4 | Medium | Agent identity is ambiguous (`assigned_agent_id` stores owner user id) | Pickup/release traces cannot identify the worker |
| O5 | Low | Frontend validator uses snake_case while backend returns camelCase | Latent validation failures |
| O6 | Low | `PUT /tickets/:id` response type drift | Callers expect a Ticket but receive `{ message }` |
| O7 | Low | Remaining docs drift | Misleading setup/maintenance |
| O8 | Low | Integration setup hides migration errors | Broken migrations can pass locally |
| O9 | Medium | Missing component tests (`EditTicketModal`, real `TicketDetail`) and stale assignment E2E | Deferred UI regressions and unverified edit behavior |
| O10 | Low | Dry-run has structural validation only, not full SQL grammar parsing | Malformed SQL can pass dry-run; explicitly deferred |

## Goals

1. Give every open defect a tracked ticket and acceptance criteria.
2. Fix production-affecting defects first: O1, O2, O4.
3. Make the test suite trustworthy: O3, O8.
4. Remove contract drift: O5, O6.
5. Finish documentation hygiene: O7 and planning/DONE moves.
6. Avoid bundling unrelated fixes into bp-123.

## Non-goals

- Re-opening the fixes already delivered in bp-123.
- Rewriting the entire agent identity model in one ticket (O4 may need a migration).
- Replacing Cypress with another framework.
- Full frontend API client regeneration (O5/O6 may trigger it).

## Functional requirements

- **FR1 - O1:** `TicketService.update()` persists `milestone_id`, `estimate`, `depends_on`; `updateMilestoneFields()` has callers and tests.
- **FR2 - O2:** either create the missing tables or remove the dead methods; no latent 500s.
- **FR3 - O3:** rewrite E2E specs for `/api/v1`, seed via API, and add a Jenkins stage.
- **FR4 - O4:** `assigned_agent_id` identifies the agent, not the owner user; pickup/release/audit are correct.
- **FR5 - O5:** frontend validator schemas match camelCase backend responses; tests updated.
- **FR6 - O6:** `PUT /tickets/:id` returns a Ticket or the client type is corrected.
- **FR7 - O7:** docs match the implementation (CI, migration count, statuses).
- **FR8 - O8:** integration setup fails the run on unexpected migration errors.
- **FR9 - O9:** add `EditTicketModal.cy.ts`, real `TicketDetail.cy.ts` coverage, and refresh the assignment E2E; verify title/description limits and clearing the assignee.
- **FR10 - O10:** decide whether to add a real SQL parser to dry-run; document the decision and add tests if implemented.
- **FR11 - Hygiene:** completed planning suites move to `planning/DONE/` with filled placeholders.

## Safety requirements

- O4 migration must preserve existing ticket/agent associations or provide a backfill.
- O2 table creation must include indexes and rollback files.
- O3 E2E must not rely on hardcoded users that do not exist.
- O5/O6 changes must not break current callers; add contract tests.
- No secrets in test fixtures.

## Acceptance criteria

1. Each defect has a ticket, owner, priority and acceptance test.
2. O1/O2/O4 are fixed or explicitly deferred with a reason.
3. E2E runs in CI and is not stale.
4. Validator and response types match backend contracts.
5. Integration setup fails on migration errors.
6. Component tests cover the edit modal and ticket detail; the assignment E2E is refreshed.
7. Dry-run grammar validation is either implemented or explicitly documented as structural-only.
8. Docs and planning statuses are current; completed suites are in `DONE/`.
9. The audit report links to this ticket and each fix.

## Out of scope

- New product features.
- Performance work.
- Multi-tenant redesign.
- The harness roadmap tickets (fg-30+).

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | audit | O1 milestone persistence | Backend | `bp-125-milestone-write-api` | No |
| 2 | audit | O2 dead SQL/tables | Backend | `bp-126-dead-sql-cleanup` | No |
| 3 | audit | O3 E2E rewrite + CI | Testing | `bp-127-cypress-e2e` | No |
| 4 | audit | O4 agent identity | Agent / DB | `bp-128-agent-identity` | No |
| 5 | audit | O5 validator camelCase | Frontend | `bp-129-validator-camelcase` | No |
| 6 | audit | O6 PUT response type | Backend / Frontend | `bp-130-ticket-update-contract` | No |
| 7 | audit | O7 docs drift | Docs | `bp-131-docs-sync` | No |
| 8 | audit | O8 integration setup | Testing | `bp-132-integration-setup-errors` | No |
