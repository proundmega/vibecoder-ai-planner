# bp-43: Break Monolithic Test Files and Delete Dead Tests

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Testing
**Priority**: P1
**Effort**: Medium

## Problem Statement

`backend/src/__tests__/role-system.test.js` is a 1,325-line monolith covering AuthService, ApprovalService, and ticket delete permissions. This makes it hard to run targeted tests, hides failures in unrelated areas, and discourages adding new tests. Separately, `unit.test.js` (108 lines) contains placeholder tests that assert `true === true` — dead code that wastes CI time. `frontend/cypress/component/TicketDetail.cy.ts` is a stub that always passes.

## Scope

- **In scope**: Split `role-system.test.js` into three focused files, trim the original, delete `unit.test.js`, fix or delete `TicketDetail.cy.ts` stub
- **Out of scope**: Adding new test coverage, changing test infrastructure

## Acceptance Criteria

- [ ] `role-system.test.js` is under 400 lines and covers only what the split files don't
- [ ] Three new test files exist: `authService.test.js`, `approvalService.test.js`, `ticketDeletePermissions.test.js`
- [ ] `unit.test.js` is deleted from the repo
- [ ] `TicketDetail.cy.ts` is either deleted or contains a real component test
- [ ] All existing tests still pass after refactor (no functional changes)
- [ ] No duplicate test coverage between the original and new files

## Known Unknowns

- **Shared mocks**: Whether `jest.setup.js` mocks are sufficient or each new file needs its own mocks
- **Test isolation**: Whether the monolith relied on shared state across test blocks

## Decisions Required

1. **Keep original file or fully delete it?**
   - Option A: Trim original to ~300 lines (cross-cutting tests), add 3 new files
   - Option B: Delete original entirely, distribute all tests across new files
   - **Recommendation**: Option A — some tests test interactions between services that don't fit neatly into one file

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/role-system.test.js` | MODIFY | Trim to cross-cutting tests only |
| `backend/src/__tests__/authService.test.js` | CREATE | AuthService.register/login/verifyToken tests from original |
| `backend/src/__tests__/approvalService.test.js` | CREATE | ApprovalService logic tests from original |
| `backend/src/__tests__/ticketDeletePermissions.test.js` | CREATE | TicketService.delete RBAC tests from original |
| `backend/src/__tests__/unit.test.js` | DELETE | Placeholder tests, no real value |
| `frontend/cypress/component/TicketDetail.cy.ts` | MODIFY | Delete or replace with real test |
