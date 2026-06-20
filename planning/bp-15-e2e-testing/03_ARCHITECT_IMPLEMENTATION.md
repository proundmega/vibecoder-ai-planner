# 03_ARCHITECT_IMPLEMENTATION.md — E2E Testing Infrastructure for Frontend

**Status**: planned
**Priority**: P2 (Medium)
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-20
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-15-e2e-testing

**Dependencies**: None

---

### a) Purpose

Add comprehensive Cypress E2E tests covering the full user lifecycle (registration → login → role assignment → ticket assignment → status transitions) and provide a test data seeding mechanism so tests don't depend on pre-existing database state.

**Value delivered**: Developers can run `npm run cypress:e2e` to verify the entire frontend workflow works correctly, from account creation through ticket management. Tests are reproducible and don't require manual DB setup.

---

### b) Actions

#### Phase 1: Custom Commands

1. **Update `cypress/support/commands.ts`**
   - Add `cy.register(name, email, password)` — registers via API, stores token in localStorage
   - Add `cy.createUser(name, email, password, role)` — creates user via API (requires admin login first)

#### Phase 2: Seed Script

2. **Create `cypress/support/seed.ts`**
   - Registers 3 users: alice (project_admin), bob (member), charlie (user)
   - Logs in all 3 users (gets tokens)
   - Creates 1 project via admin API
   - Creates 2 tickets via admin API
   - Uses timestamp-based names for isolation
   - Exports `seed()` function

#### Phase 3: E2E Test Files

3. **Create `cypress/e2e/05-registration.cy.ts`**
   - Test: renders registration page with name, email, password fields
   - Test: registers a new account and redirects to dashboard
   - Test: shows error on weak password
   - Test: redirects to login from registration page
   - Test: handles duplicate email registration

4. **Create `cypress/e2e/06-user-management.cy.ts`**
   - Test: displays user management page with user table
   - Test: creates a new user with a specific role
   - Test: toggles user active/inactive status
   - Test: deletes a user with confirmation
   - Test: enforces role-based permissions (user role cannot access /users)
   - Test: searches users by name or email
   - Test: filters users by role

5. **Create `cypress/e2e/07-ticket-assignment.cy.ts`**
   - Test: assigns a ticket to a user
   - Test: reassigns a ticket to a different user
   - Test: shows status transitions based on current status
   - Test: shows assignee name in ticket detail
   - Test: full workflow (register → create user → assign ticket → change status)

#### Phase 4: Documentation

6. **Update `AGENTS.md`**
   - Add "Cypress E2E Testing" section
   - Document how to run tests locally (`npm run cypress:e2e`)
   - Document how seed script works
   - Document how to run all tests (`npm run cypress:all`)

---

### c) Dependencies

- **None** — self-contained change
- **No new dependencies** — all packages already in `package.json`
- **Existing**: Backend API endpoints (`/api/auth/register`, `/api/users`, `/api/projects`, `/api/tickets`)

---

### d) Risks/Edge Cases

- **[Seed failure]**: If seed fails, all tests fail. Mitigation: add try/catch in seed, log errors clearly.
- **[Test order dependency]**: Tests running in different orders produce different results. Mitigation: each test is self-contained, uses seed data as base.
- **[Flaky tests]**: Cypress tests can be flaky. Mitigation: use `cy.get().should()` instead of `cy.wait()`, consistent viewport.
- **[Token expiration]**: Auth tokens might expire. Mitigation: seed creates fresh tokens for each test run.

---

### e) Testing

#### Cypress E2E Tests

**05-registration.cy.ts**
- [ ] Renders registration page with name, email, password fields
- [ ] Registers a new account and redirects to dashboard
- [ ] Shows error on weak password (less than 6 chars)
- [ ] Redirects to login from registration page
- [ ] Handles duplicate email registration (shows error)

**06-user-management.cy.ts**
- [ ] Displays user management page with user table
- [ ] Creates a new user with a specific role
- [ ] Toggles user active/inactive status
- [ ] Deletes a user with confirmation
- [ ] Enforces role-based permissions (user role redirected from /users)
- [ ] Searches users by name or email
- [ ] Filters users by role

**07-ticket-assignment.cy.ts**
- [ ] Assigns a ticket to a user via edit modal
- [ ] Reassigns a ticket to a different user
- [ ] Shows status transitions based on current status
- [ ] Shows assignee name in ticket detail
- [ ] Full workflow: register → create user → assign ticket → change status

#### Integration Tests (Backend API)

- [ ] POST /api/auth/register creates account and returns token
- [ ] POST /api/users creates user (admin only)
- [ ] PUT /api/users/:id updates user (admin only)
- [ ] PATCH /api/users/:id/toggle-active toggles active/inactive
- [ ] DELETE /api/users/:id deletes user (admin only)
- [ ] PUT /api/tickets/:id updates ticket (assignee, status, etc.)

#### Existing Tests (No Regressions)

- [ ] 01-auth.cy.ts — all 7 tests pass
- [ ] 02-projects.cy.ts — all 5 tests pass
- [ ] 03-tickets.cy.ts — all 7 tests pass
- [ ] 04-roles.cy.ts — all 10 tests pass
- [ ] Component tests (5 files) — all pass

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — only test files added, no production code changes
- **Downtime**: None
- **Verification after rollback**: Run `npm run cypress:e2e` — only 4 spec files should run (01-04)

---

### g) Files Changed

**NEW files:**
- `frontend/cypress/support/seed.ts` — test data seeding (creates users, project, tickets)
- `frontend/cypress/e2e/05-registration.cy.ts` — registration flow tests
- `frontend/cypress/e2e/06-user-management.cy.ts` — user management tests
- `frontend/cypress/e2e/07-ticket-assignment.cy.ts` — ticket assignment tests

**CHANGED files:**
- `frontend/cypress/support/commands.ts` — add `cy.register()` and `cy.createUser()` commands
- `AGENTS.md` — add Cypress E2E section (how to run, how to seed)

---

### h) Code Review Checklist

- [ ] `cy.register()` stores token and user in localStorage (same as `cy.login()`)
- [ ] `cy.createUser()` requires admin login first (alice@example.com)
- [ ] Seed script creates timestamp-based names (no conflicts between runs)
- [ ] Seed script is idempotent (safe to run multiple times)
- [ ] All tests use `cy.get().should()` instead of `cy.wait()` (no hardcoded timeouts)
- [ ] Tests are self-contained (each test can run independently)
- [ ] No duplication of existing test logic (01-04 are good, extend the coverage)
- [ ] Seed script error handling (try/catch with clear error messages)
- [ ] Registration test uses `cy.register()` command, not `cy.visit()` + form fill
- [ ] User management tests use existing UI (no mock components)

---

### i) Post-Deploy Verification

- [ ] `npm run cypress:e2e` runs all 7 e2e spec files
- [ ] `npm run cypress:all` runs all e2e + component tests
- [ ] All 7 e2e spec files pass (no failures)
- [ ] All 5 component tests pass (no regressions)
- [ ] Seed script runs before e2e tests (creates clean state)
- [ ] Tests are deterministic (same result every run, no flakiness)

---

### j) Notes

- Seed script runs in global `before` hook (once per test suite run)
- Tests use timestamp-based names to avoid conflicts
- No new npm scripts needed (existing `cypress:e2e` and `cypress:all` work as-is)
- Seed script can be extended later for approval workflow tests
- CI integration can be added in a follow-up PR

---

*Ready for implementation.*
