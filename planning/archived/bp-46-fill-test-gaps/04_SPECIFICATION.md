# bp-46: Add Missing Test Coverage for Untested Code Paths — Spec

**Target model**: 7B–14B (JavaScript, TypeScript)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/src/__tests__/auth-store.test.js`

**Add after existing tests**:

```javascript
describe('member role syncPermissions', () => {
  const memberPerms = syncPermissions('member');

  it('includes TICKET_CREATE, TICKET_READ, TICKET_UPDATE', () => {
    expect(memberPerms).toEqual(
      expect.arrayContaining(['TICKET_CREATE', 'TICKET_READ', 'TICKET_UPDATE'])
    );
  });

  it('excludes APPROVAL_VIEW', () => {
    expect(memberPerms).not.toContain('APPROVAL_VIEW');
  });
});

describe('project_admin role syncPermissions', () => {
  const adminPerms = syncPermissions('project_admin');

  it('includes TICKET_DELETE', () => {
    expect(adminPerms).toContain('TICKET_DELETE');
  });

  it('includes PROJECT_CREATE and PROJECT_DELETE', () => {
    expect(adminPerms).toEqual(
      expect.arrayContaining(['PROJECT_CREATE', 'PROJECT_DELETE'])
    );
  });
});
```

### MODIFY: `backend/src/__tests__/client.test.js`

**Add after patch tests**:

```javascript
describe('postMultipart', () => {
  it('sends multipart form data', async () => {
    fetchMock.mockResponse(JSON.stringify({ success: true, data: { id: 1 } }));
    const result = await client.postMultipart('/upload', new FormData());
    expect(result.success).toBe(true);
  });
});

describe('edge cases', () => {
  it('handles response.json() failure', async () => {
    fetchMock.mockReject(new Error('JSON parse error'));
    await expect(client.get('/fail')).rejects.toThrow();
  });

  it('handles null data property', async () => {
    fetchMock.mockResponse(JSON.stringify({ success: true, data: null }));
    const result = await client.get('/null-data');
    expect(result.data).toBeNull();
  });

  it('calls patch without body', async () => {
    fetchMock.mockResponse(JSON.stringify({ success: true }));
    const result = await client.patch('/no-body');
    expect(result.success).toBe(true);
  });
});
```

### MODIFY: `frontend/cypress.config.ts`

```typescript
import { defineConfig } from 'cypress';
import seed from './cypress/support/seed';

export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
    setupNodeEvents(on) {
      on('task', { seed });
    },
  },
  component: {
    devServer: { framework: 'vue', bundler: 'vite' },
  },
});
```

### MODIFY: `frontend/cypress/support/commands.ts`

```typescript
Cypress.Commands.add('seedDatabase', () => {
  return cy.task('seed');
});
```

### MODIFY: `frontend/cypress/e2e/*.cy.ts` (7 files)

**Replace in each file**:
```typescript
// Before:
cy.get('[data-cy=email]').type('alice@example.com');
cy.get('[data-cy=password]').type('password123');

// After (add in beforeEach or at top of test):
const ts = Date.now();
const email = `user-${ts}@example.com`;
cy.seedDatabase();
cy.get('[data-cy=email]').type(email);
cy.get('[data-cy=password]').type('password123');
```

## Test Expectations

```
✓ auth-store.test.js passes with member and project_admin role tests
✓ client.test.js passes with postMultipart and edge case tests
✓ cypress.config.ts registers seed task
✓ commands.ts exposes cy.seedDatabase()
✓ All 7 E2E tests pass using seeded data
✓ No hardcoded alice@example.com in E2E tests
```

## Edge Cases

1. **Seed task returns promise**: Cypress task should return a Promise (seed() returns a Promise)
2. **Concurrent E2E test runs**: Timestamp-based emails prevent cross-test collisions
3. **Non-JSON error body**: Client should not crash — test verifies graceful error extraction
4. **postMultipart without FormData**: Should throw a descriptive error
