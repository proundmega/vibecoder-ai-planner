# bp-46: Add Missing Test Coverage for Untested Code Paths — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing

## Current State

### Backend Gaps

`auth-store.test.js`:
- Tests for default role but not for `member` or `project_admin`
- `syncPermissions` is not tested for roles with explicit permission lists

`client.test.js`:
- Tests `get`, `post`, `put`, `delete` but not `postMultipart`
- Tests normal JSON responses but not edge cases: non-JSON body, null data, response.json() failure
- Tests `patch` only with body argument

### Frontend Gaps

E2E tests use hardcoded values like `alice@example.com`. If tests run against different DB states, they fail. The `seed.ts` script exists but is not integrated with Cypress.

## Proposed Solution

### Backend: auth-store.test.js additions

Add `describe('member role')` and `describe('project_admin role')` blocks that test:
1. `syncPermissions()` returns correct permission list for each role
2. Permissions include expected scopes (TICKET_CREATE/READ/UPDATE/DELETE for member, broader set for project_admin)

### Backend: client.test.js additions

Add tests for:
1. `postMultipart()` — verify multipart headers, error handling, response format
2. `response.json()` failure — mock fetch to return non-JSON body, verify error
3. Null `data` property — mock response returns `{ success: true, data: null }`, verify handled
4. `patch()` called without body — verify it sends `undefined` or `null` as body

### Frontend: Cypress seed integration

1. **`cypress.config.ts`**: Add `setupNodeEvents` with `on('task', { seed: () => seed() })`
2. **`commands.ts`**: Add `Cypress.Commands.add('seedDatabase', () => cy.task('seed'))`
3. **E2E tests**: Replace `cy.visit('/login').type('alice@example.com')` with seed + unique generated data

## Alternatives Considered

- **Option A: cy.exec('npx tsx seed.ts')** — Rejected, fragile path resolution
- **Option C: before() hook with direct DB import** — Rejected, imports may fail in browser context

## File-Level Impact Matrix

| File | Action | Details |
|------|--------|---------|
| `backend/src/__tests__/auth-store.test.js` | MODIFY | Add member and project_admin permission tests |
| `backend/src/__tests__/client.test.js` | MODIFY | Add postMultipart and edge case tests |
| `frontend/cypress.config.ts` | MODIFY | Add setupNodeEvents with seed task |
| `frontend/cypress/support/commands.ts` | MODIFY | Add cy.seedDatabase() command |
| `frontend/cypress/e2e/*.cy.ts` (7 files) | MODIFY | Replace hardcoded data with seed + unique values |
