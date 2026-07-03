# bp-46: Add Missing Test Coverage for Untested Code Paths — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Scope**: Testing

## Purpose
Add missing unit tests for backend code paths and wire Cypress seed command into E2E tests.

## Implementation Order

1. **Backend: Add role tests to auth-store.test.js**
2. **Backend: Add edge case tests to client.test.js**
3. **Frontend: Add seed task to cypress.config.ts**
4. **Frontend: Add cy.seedDatabase() command**
5. **Frontend: Update 7 E2E tests to use seeded data**
6. **Run full suite** — verify all pass

## Per-File Action Plan

### `backend/src/__tests__/auth-store.test.js` (MODIFY)

Add these describe blocks after existing tests:

```javascript
describe('member role syncPermissions', () => {
  it('returns TICKET_CREATE, TICKET_READ, TICKET_UPDATE, TICKET_DELETE');
  it('excludes APPROVAL_VIEW and ADMIN permissions');
  it('includes PROJECT_READ and USER_READ');
});

describe('project_admin role syncPermissions', () => {
  it('returns all 20 permissions including ADMIN scopes');
  it('includes PROJECT_CREATE, PROJECT_DELETE, PROJECT_UPDATE');
  it('includes TICKET_DELETE and TICKET_ASSIGN');
  it('includes USER_INVITE and USER_ROLE_CHANGE');
});
```

### `backend/src/__tests__/client.test.js` (MODIFY)

Add after existing `describe('patch')` block:

```javascript
describe('postMultipart', () => {
  it('sends multipart form data');
  it('sets correct Content-Type header with boundary');
  it('handles server error response');
  it('triggers 401 redirect on auth failure');
});

describe('edge cases', () => {
  it('handles response.json() rejection');
  it('handles non-JSON error body gracefully');
  it('handles null data property in response');
  it('calls patch without body argument');
});
```

### `frontend/cypress.config.ts` (MODIFY)

Add to `defineConfig`:
```typescript
import { defineConfig } from 'cypress';
import seed from './cypress/support/seed';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on, config) {
      on('task', {
        seed() {
          return seed();
        },
      });
      return config;
    },
  },
});
```

### `frontend/cypress/support/commands.ts` (MODIFY)

Add:
```typescript
Cypress.Commands.add('seedDatabase', () => {
  return cy.task('seed');
});
```

### `frontend/cypress/e2e/*.cy.ts` (MODIFY, 7 files)

Replace hardcoded `alice@example.com` with:
```typescript
const timestamp = Date.now();
const email = `user-${timestamp}@example.com`;
// use email in all test data
```

Add to `beforeEach`:
```typescript
beforeEach(() => {
  cy.seedDatabase();
});
```

## Migration Plan
No database changes.

## Test Plan
1. Run `npm test` in backend — verify new tests pass
2. Run `npm test -- --run` in frontend — verify unit tests pass
3. Run `npx cypress run --e2e --headless` in frontend — verify E2E tests pass
4. Verify no hardcoded `alice@example.com` remains in E2E tests

## Rollback Steps
1. Revert auth-store.test.js and client.test.js
2. Revert cypress.config.ts and commands.ts
3. Revert E2E test files to hardcoded data
