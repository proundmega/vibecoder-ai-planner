# 01_ARCHITECT_REQUIREMENT.md — E2E Testing Infrastructure for Frontend

**Status**: planned
**Date created**: 2026-06-20
**Author**: AI Assistant

---

## Requirement

Add comprehensive Cypress E2E tests covering the full user lifecycle (registration → login → role assignment → ticket assignment → status transitions) and provide a test data seeding mechanism so tests don't depend on pre-existing database state.

---

## Scope

### In Scope
- Add `cy.register()` custom command (registers a new account via API, stores token in localStorage)
- Add `cy.createUser()` custom command (creates a user via API, returns user ID)
- Add `cypress/support/seed.ts` — creates test data: users with different roles, a project, and tickets
- Add `cypress/e2e/05-registration.cy.ts` — registration flow tests
- Add `cypress/e2e/06-user-management.cy.ts` — user CRUD and role assignment tests
- Add `cypress/e2e/07-ticket-assignment.cy.ts` — ticket assignment and full workflow tests
- Update `AGENTS.md` with Cypress E2E section (how to run, how to seed data)

### Out of Scope
- CI integration (`.github/workflows/ci.yml` update) — can be added in a follow-up PR
- Backend API changes (all endpoints already exist)
- Frontend UI changes (all UI components already exist)
- Approval workflow tests (can be added in a follow-up PR — requires backend approval state)
- Component test additions (existing 5 component tests are sufficient)
- Test parallelization (Cypress cloud or multiple workers)

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **Should the seed script run automatically before each test run, or be triggered manually?**
   - Automatic — seed.ts is imported in `cypress/support/e2e.ts` and runs in a global `before` hook
   - Manual — add `npm run cypress:seed` script, run before `cypress:e2e`
   - Hybrid — auto-seed in CI, manual in dev mode

2. **Should tests clean up their own data, or rely on the seed script to create clean state?**
   - Seed-only — seed creates fresh state before each test run, tests just interact with it
   - Self-cleanup — each test creates timestamped data and deletes it in `afterEach`
   - Hybrid — seed creates base state, tests create their own ephemeral data and clean up

---

## Acceptance Criteria

- [ ] `cy.register(email, password, name)` command registers a new user and stores token in localStorage
- [ ] `cy.createUser(name, email, password, role)` command creates a user via API and returns user ID
- [ ] `seed.ts` creates: alice (project_admin), bob (member), charlie (user), 1 project, 2 tickets
- [ ] `05-registration.cy.ts` has ≥4 tests: render, valid register, invalid password, redirect
- [ ] `06-user-management.cy.ts` has ≥6 tests: create user, assign role, toggle active, delete, permission check, search/filter
- [ ] `07-ticket-assignment.cy.ts` has ≥5 tests: assign ticket, reassign ticket, status transition with assignee, full workflow (register → create user → assign ticket)
- [ ] All existing tests (01-04) still pass after changes
- [ ] `npm run cypress:e2e` runs all 7 e2e spec files without errors
- [ ] Seed script is idempotent (can run multiple times without errors)
- [ ] No hardcoded timeouts in tests (use `cy.get().should()` or `cy.intercept()` instead of `cy.wait(1000)`)
- [ ] AGENTS.md updated with Cypress E2E section

---

## Testing Checklist

### Cypress E2E Tests
- [ ] Registration: form renders with name, email, password fields
- [ ] Registration: valid registration creates account and redirects to dashboard
- [ ] Registration: invalid password (too short) shows error
- [ ] Registration: duplicate email shows error
- [ ] User Management: can create a new user with a specific role
- [ ] User Management: can edit a user's role
- [ ] User Management: can toggle user active/inactive
- [ ] User Management: can delete a user (with confirmation)
- [ ] User Management: role-based permission enforcement (user role cannot access /users)
- [ ] User Management: search/filter works
- [ ] Ticket Assignment: can assign a ticket to a user
- [ ] Ticket Assignment: can reassign a ticket to a different user
- [ ] Ticket Assignment: status transitions respect assignee
- [ ] Full Workflow: register new account → create user with role → assign ticket → change status
- [ ] All existing tests (auth, projects, tickets, roles) still pass

### Seed Script
- [ ] Creates alice@example.com as project_admin
- [ ] Creates bob@example.com as member
- [ ] Creates charlie@example.com as user
- [ ] Creates 1 project with 2 tickets
- [ ] Is idempotent (safe to run multiple times)
- [ ] Cleans up previous test data before creating new data

---

## CI Requirements (MANDATORY)

- `npm run cypress:e2e` — all e2e tests must pass
- `npm run cypress:all` — all e2e + component tests must pass
- No new linting errors (`npm run lint` passes)

---

## Anti-Patterns to Avoid

- ❌ Hardcoded `cy.wait(1000)` — use `cy.get().should()` or `cy.intercept()` instead
- ❌ Tests depending on pre-existing DB state — use seed script
- ❌ Tests creating data without cleanup — use timestamp-based names or seed-only approach
- ❌ Duplicating existing test logic — 01-04 tests are already good, just extend the coverage
- ❌ Testing backend logic in frontend tests — only test UI behavior, not API implementation
- ❌ Using `cy.visit()` for API-driven tests — use `cy.request()` for API calls (login, create user)

---

*Ready for design phase.*
