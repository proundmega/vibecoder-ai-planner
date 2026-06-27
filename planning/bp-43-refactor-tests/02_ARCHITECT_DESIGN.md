# bp-43: Break Monolithic Test Files and Delete Dead Tests — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing

## Current State

```
backend/src/__tests__/
├── role-system.test.js   (1,325 lines — AuthService, ApprovalService, TicketDeletePermissions, etc.)
├── unit.test.js           (108 lines — placeholder, always passes)
├── auth-store.test.js
├── client.test.js
├── ...                    (14 other test files)
```

`role-system.test.js` contains tests for three distinct service areas:
- AuthService.register, login, verifyToken (lines 1–400)
- ApprovalService.approve, reject, listForUser (lines 401–800)
- TicketService.delete with RBAC checks (lines 801–1325)

## Proposed Solution

### Extraction Plan

Extract test blocks by `describe` scope:

```
authService.test.js            ← describe("AuthService", ...) block
approvalService.test.js        ← describe("ApprovalService", ...) block
ticketDeletePermissions.test.js ← describe("TicketService.delete permissions", ...) block
```

Each new file gets its own imports and `jest.mock()` calls where needed. Shared mocks (pg pool, winston, jwt) remain in `jest.setup.js`.

### What Stays in role-system.test.js

- Tests that cross service boundaries (e.g., "register user then approve ticket as admin")
- Integration-style tests that chain multiple services
- Any test that depends on test ordering or shared `describe` context

### Dead File Removal

- `unit.test.js`: Delete. If any test runner config references it, update `testMatch` or `testPathIgnorePatterns`.
- `TicketDetail.cy.ts`: Delete if stub. If there's a real component test somewhere, keep it.

### Dependency Check

Search `jest.config.js` for `unit.test.js` in `testPathIgnorePatterns` — remove the reference. Check `testMatch` glob patterns.

## Alternatives Considered

- **Leave as-is**: Bad — monoliths discourage contributions and mask failures
- **Lazy split by line range**: Rejected — boundaries would be arbitrary, not semantic

## File-Level Impact Matrix

| File | Action | Details |
|------|--------|---------|
| `backend/src/__tests__/role-system.test.js` | MODIFY | Remove extracted describe blocks, keep cross-cutting tests |
| `backend/src/__tests__/authService.test.js` | CREATE | Extracted AuthService tests + proper imports |
| `backend/src/__tests__/approvalService.test.js` | CREATE | Extracted ApprovalService tests + proper imports |
| `backend/src/__tests__/ticketDeletePermissions.test.js` | CREATE | Extracted TicketService.delete tests + proper imports |
| `backend/src/__tests__/unit.test.js` | DELETE | Remove file entirely |
| `frontend/cypress/component/TicketDetail.cy.ts` | MODIFY or DELETE | Remove stub or replace with real test |
