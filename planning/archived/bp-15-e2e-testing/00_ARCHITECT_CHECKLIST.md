# 00_ARCHITECT_CHECKLIST.md — E2E Testing Infrastructure

**Status**: planned
**Date created**: 2026-06-20
**Author**: AI Assistant

---

## Pre-Implementation Checklist

### Existing Infrastructure Audit
- [x] Cypress E2E tests exist: `cypress/e2e/01-auth.cy.ts`, `02-projects.cy.ts`, `03-tickets.cy.ts`, `04-roles.cy.ts`
- [x] Cypress component tests exist: 5 files under `cypress/component/`
- [x] Custom commands exist: `login`, `loginAsAdmin`, `logout`, `createProject`, `createTicket`
- [x] Fixtures exist: `users.json`, `projects.json`, `tickets.json`
- [x] `cypress.config.ts` configured with e2e and component suites
- [x] `cypress/support/commands.ts` has `cy.login()` using API-backed auth
- [x] `cypress/support/e2e.ts` has Vite navigation error suppression
- [x] `package.json` scripts: `cypress:open`, `cypress:component`, `cypress:e2e`, `cypress:all`
- [x] `cypress-localstorage-commands` package installed
- [x] Retries configured: `runMode: 1, openMode: 0`

### What's Missing
- [ ] Registration flow test (no test for `Register.vue`)
- [ ] User management test (no test for creating users, assigning roles, toggling active, deleting)
- [ ] Ticket assignment test (no test for assigning tickets to users, reassigning)
- [ ] Approval workflow test (no test for `requestApproval()` → pending → approved)
- [ ] Test data seeding (tests depend on pre-existing DB state)
- [ ] CI integration (Cypress not in `.github/workflows/ci.yml`)
- [ ] `cy.register()` custom command
- [ ] `cy.createUser()` custom command
- [ ] Full end-to-end workflow: register → create user with role → assign ticket

### Files That Need Changes
- `frontend/cypress/support/commands.ts` — add 2 new commands
- `frontend/cypress/support/seed.ts` — NEW file for test data seeding
- `frontend/cypress/e2e/05-registration.cy.ts` — NEW file
- `frontend/cypress/e2e/06-user-management.cy.ts` — NEW file
- `frontend/cypress/e2e/07-ticket-assignment.cy.ts` — NEW file
- `frontend/AGENTS.md` (or `AGENTS.md`) — add Cypress E2E section with how to run

### Files That Do NOT Need Changes
- `cypress.config.ts` — already configured correctly
- `cypress/support/e2e.ts` — error handling is sufficient
- `cypress/fixtures/` — existing fixtures are fine, seeding will supplement
- `frontend/src/` — no frontend code changes needed
- `backend/src/` — no backend code changes needed

### Risks
- **[Flaky tests]**: E2E tests can be flaky due to timing. Mitigation: use `cy.wait()` strategically, avoid hardcoded timeouts.
- **[Test data conflicts]**: Tests creating projects/tickets may conflict. Mitigation: use timestamp-based names, clean up in `afterEach`.
- **[DB state dependency]**: Tests assume pre-existing users and projects. Mitigation: seed script creates clean state before each test run.
- **[CI environment]**: Cypress in CI needs a real browser and running app. Mitigation: use Docker Compose in CI, run app before Cypress.

---

## Post-Implementation Checklist

### Code Review
- [ ] `cy.register()` command authenticates and stores token in localStorage
- [ ] `cy.createUser()` command creates a user via API and returns user ID
- [ ] Seed script creates: 1 project_admin, 1 member, 1 user, 1 project, 2 tickets
- [ ] Seed script is idempotent (can be run multiple times, cleans up previous test data)
- [ ] Registration test covers: form render, valid registration, invalid password, redirect to dashboard
- [ ] User management test covers: create user, assign role, toggle active, delete user, permission enforcement
- [ ] Ticket assignment test covers: assign ticket, reassign ticket, status transitions with assigned user
- [ ] All existing tests still pass (no regressions)
- [ ] No hardcoded timeouts (`cy.wait()` only where necessary, not fixed durations)

### Testing
- [ ] `npm run cypress:e2e` runs all 7 e2e spec files
- [ ] `npm run cypress:all` runs both e2e and component tests
- [ ] Seed script runs before e2e tests (via `before` hook or support file)
- [ ] Tests are deterministic (same result every run, no flakiness)
- [ ] Tests clean up their own data (timestamp-based names)

### Documentation
- [ ] AGENTS.md updated with Cypress E2E section
- [ ] How to run Cypress locally documented
- [ ] How to run Cypress in CI documented
- [ ] How to seed test data documented

---

*Ready for requirement phase.*
