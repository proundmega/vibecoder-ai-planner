# bp-43: Break Monolithic Test Files and Delete Dead Tests — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Testing

## Purpose
Break down `role-system.test.js` into focused test files and delete dead test files.

## Implementation Order

1. **Read `role-system.test.js`** — identify `describe` blocks for extraction
2. **Create `authService.test.js`** — extract AuthService tests
3. **Create `approvalService.test.js`** — extract ApprovalService tests
4. **Create `ticketDeletePermissions.test.js`** — extract TicketService.delete tests
5. **Trim `role-system.test.js`** — keep only cross-cutting tests
6. **Delete `backend/src/__tests__/unit.test.js`**
7. **Delete or fix `frontend/cypress/component/TicketDetail.cy.ts`**
8. **Run full test suite** — verify nothing is broken

## Per-File Action Plan

### `backend/src/__tests__/role-system.test.js` (MODIFY)
1. Locate all `describe("AuthService"` blocks and remove them entirely
2. Locate all `describe("ApprovalService"` blocks and remove them entirely
3. Locate all `describe("TicketService.delete"`, `describe("delete permissions"`, or similar blocks and remove
4. Verify remaining tests still pass — may need to keep some shared `beforeEach` setup

### `backend/src/__tests__/authService.test.js` (CREATE)
```javascript
const AuthService = require('services/auth');
// ...extracted tests from original, with proper imports
```
- Add `jest.mock()` for any service dependencies not covered by `jest.setup.js`
- Remove any test-ordering assumptions

### `backend/src/__tests__/approvalService.test.js` (CREATE)
```javascript
const ApprovalService = require('services/approval');
// ...extracted tests
```

### `backend/src/__tests__/ticketDeletePermissions.test.js` (CREATE)
```javascript
const TicketService = require('services/ticket');
const { ROLES } = require('models/roles');
// ...extracted tests
```

### `backend/src/__tests__/unit.test.js` (DELETE)
- Remove the file
- Check `jest.config.js` — ensure no reference to `unit.test.js`

### `frontend/cypress/component/TicketDetail.cy.ts` (MODIFY or DELETE)
- Read the file first
- If it's a stub (`it('passes', () => {})`), delete it
- If it has real assertions but is failing, fix it

## Migration Plan
No database changes. No API changes.

## Test Plan
1. Run `npm test` in backend — all tests must pass
2. Run `npm test -- --run` in frontend — all tests must pass
3. Verify no duplicate `describe` strings between new files and trimmed original
4. Run `npx jest --listTests` to confirm all files are picked up

## Rollback Steps
1. Restore deleted files from git
2. Revert trimmed `role-system.test.js`
3. Delete new files
