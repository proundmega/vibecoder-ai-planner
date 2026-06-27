# bp-46: Add Missing Test Coverage for Untested Code Paths

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing
**Priority**: P2
**Effort**: Medium

## Problem Statement

Several code paths in the backend have no test coverage: `auth-store.test.js` doesn't test `member`/`project_admin` role sync permissions, `client.test.js` misses `postMultipart` and edge cases. Frontend E2E tests use hardcoded data and have no seed command integration, making them fragile across environments.

## Scope

- **In scope**: Add unit tests for missing backend paths, wire `seed.ts` into Cypress commands, update E2E tests to use seeded data
- **Out of scope**: Adding new E2E tests, rewriting existing tests

## Acceptance Criteria

- [ ] `auth-store.test.js` has tests for `member` role's `syncPermissions` (TICKET_CREATE/READ/UPDATE/DELETE etc.) and `project_admin` role's full set
- [ ] `client.test.js` has tests for `postMultipart`, non-JSON error body, null `data` property, `patch` without body
- [ ] `cy.seedDatabase()` Cypress command exists (calls `seed()` programmatically)
- [ ] All 7 E2E tests use timestamp-based data or `cy.seedDatabase()` instead of hardcoded values
- [ ] All tests pass

## Known Unknowns

- **Seed.ts dependencies**: Whether `seed.ts` can run in Cypress's Node environment vs browser environment
- **Existing E2E data patterns**: Whether tests use unique data or clash with each other

## Decisions Required

1. **Seed mechanism for Cypress?**
   - Option A: `cy.seedDatabase()` custom command that calls `seed()` via Cypress task
   - Option B: `cy.task('seed')` that executes seed.ts in Node context
   - **Recommendation**: Option B — `cy.task()` runs in Node, no browser context issues

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/auth-store.test.js` | MODIFY | Add member and project_admin syncPermissions tests |
| `backend/src/__tests__/client.test.js` | MODIFY | Add postMultipart, edge case tests |
| `frontend/cypress/support/commands.ts` | MODIFY | Add `cy.seedDatabase()` command |
| `frontend/cypress.config.ts` | MODIFY | Add `cy.task('seed')` setup |
| `frontend/cypress/e2e/*.cy.ts` | MODIFY | Replace hardcoded data with seeded data |
