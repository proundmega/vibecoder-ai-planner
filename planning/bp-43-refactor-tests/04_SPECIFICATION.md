# bp-43: Break Monolithic Test Files and Delete Dead Tests — Spec

**Target model**: 7B–14B (JavaScript, Jest)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/src/__tests__/role-system.test.js`

**Action**: Remove extracted `describe` blocks.

1. Remove the entire `describe("AuthService"` block (including all nested `describe`/`it`/`beforeEach`)
2. Remove the entire `describe("ApprovalService"` block
3. Remove the entire `describe("TicketService.delete"` block (or `describe("delete permissions"`)
4. Ensure top-level imports are preserved — they may still be needed
5. Ensure any `beforeAll` that applies to remaining tests stays

**Result**: File should be under 400 lines, containing only cross-cutting tests like "register user then approve as admin".

### CREATE: `backend/src/__tests__/authService.test.js`

```javascript
const AuthService = require('services/auth');

jest.mock('models/user');
jest.mock('services/token');

describe('AuthService', () => {
  describe('register', () => {
    it('creates user and returns token');
    it('rejects duplicate email');
    it('hashes password before storing');
  });
  describe('login', () => {
    it('returns token for valid credentials');
    it('throws on wrong password');
    it('increments failure count on bad login');
    it('locks account after 10 failures');
  });
  describe('verifyToken', () => {
    it('returns decoded payload for valid token');
    it('throws on expired token');
    it('throws on invalid signature');
  });
});
```

### CREATE: `backend/src/__tests__/approvalService.test.js`

```javascript
const ApprovalService = require('services/approval');

describe('ApprovalService', () => {
  describe('approve', () => {
    it('sets ticket status to approved');
    it('notifies requester');
    it('rejects if user lacks APPROVAL_VIEW');
  });
  describe('reject', () => {
    it('sets ticket status to rejected with reason');
    it('notifies requester with reason');
  });
  describe('listForUser', () => {
    it('returns tickets pending user approval');
    it('returns empty list when none pending');
  });
});
```

### CREATE: `backend/src/__tests__/ticketDeletePermissions.test.js`

```javascript
const TicketService = require('services/ticket');
const { ROLES } = require('models/roles');

describe('TicketService.delete', () => {
  describe('RBAC enforcement', () => {
    it('allows super_admin to delete any ticket');
    it('allows project_admin to delete ticket in their project');
    it('rejects user role');
    it('rejects member role');
    it('rejects unauthenticated');
  });
  describe('deletion logic', () => {
    it('soft-deletes by setting deleted_at');
    it('returns ticket data after deletion');
    it('throws if ticket not found');
  });
});
```

### DELETE: `backend/src/__tests__/unit.test.js`

Remove the file. Check `jest.config.js` for any exclusion pattern that references it.

### DELETE or MODIFY: `frontend/cypress/component/TicketDetail.cy.ts`

If content is:
```typescript
it('passes', () => {});
```
→ DELETE the file.

If it has meaningful test content, keep it.

## Test Expectations

```
✓ npm test passes in backend (all tests, including new files)
✓ npm test -- --run passes in frontend
✓ npx jest --listTests shows all 4 files (original + 3 new)
✓ No duplicate test names across files
✓ unit.test.js no longer exists in repo
```

## Edge Cases

1. **Shared `beforeEach`**: If extracted blocks reference variables from parent scope, those must be duplicated in the new file
2. **Mock clashes**: Two new files might try to mock the same module differently — ensure mocks are isolated per-file (automatically handled by Jest module isolation)
3. **Integration config**: Verify Jest config picks up the new files — glob pattern `**/__tests__/**/*.test.js` should match
