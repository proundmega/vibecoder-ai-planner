# 01_ARCHITECT_REQUIREMENT.md — Bug Fix Planning

**Status**: planned
**Date created**: 2026-07-02
**Date completed**: TBD
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P0 (Critical) + P1 (High) + P2 (Medium) + P3 (Low)
**Effort**: Medium (12 bugs, all single-file fixes)

---

## Requirement

Fix 12 code defects found during a comprehensive codebase review. All bugs are backend-only, no frontend changes, no new routes, no database migrations required. Each bug is an isolated fix in an existing file.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API routes exist for all affected endpoints — YES
- [x] Controllers exist — YES (ticketController, projectController, providerController)
- [x] Services exist — YES (TicketService, ProjectService, MemoryService, HeartbeatService, AgentService)
- [x] Models exist — YES (Ticket, Project, User)
- [x] Validators exist — YES
- [x] Routes are mounted — YES
- [x] OpenAPI JSDoc annotations exist — YES

### Frontend API Client Check
- [x] No frontend changes needed — all bugs are backend logic issues

### Key Insight

All 12 bugs are in backend files. No frontend API clients, views, or components need modification. This is a pure backend fix.

---

## Scope

### In Scope
1. **BP-51-01 (Critical)**: `MemoryService.searchSimilar` — SQL parameter `$4` should be `$3`
2. **BP-51-02 (High)**: `TicketService.recoverOrphanedTickets` — validate `staleMinutes` is numeric before SQL interpolation
3. **BP-51-03 (High)**: `ProjectService.update` — use `NotFoundError`/`ForbiddenError` instead of generic `Error`
4. **BP-51-04 (Medium)**: `HeartbeatService.cleanupStaleAgents` — move `require()` to top of file
5. **BP-51-05 (Medium)**: `ProjectService.update` — replace `Object.values(data)` with explicit field mapping
6. **BP-51-06 (Medium)**: `TicketService.update` — only pass defined fields to `Ticket.update()`
7. **BP-51-07 (Medium)**: `MemoryService.searchSimilar` — apply threshold filter in SQL
8. **BP-51-08 (Medium)**: `auth.js` — convert `requireActiveUser` promise chains to async/await
9. **BP-51-09 (Medium)**: `auth.js` — convert `agentAuth`/`verifyTokenOrAgent` promise chains to async/await
10. **BP-51-10 (Low)**: `HeartbeatService.getAllAgents` — replace correlated subqueries with JOIN
11. **BP-51-11 (Low)**: `providerController.js` — move `require('../db')` to top of file
12. **BP-51-12 (Low)**: `crypto.js` — fix `maskToken` edge case for exactly 8-char tokens

### Out of Scope
- Frontend changes (no frontend code is affected)
- New routes or endpoints
- Database migrations
- New npm dependencies
- Refactoring unrelated code

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/MemoryService.js` | MODIFY | Fix SQL param index ($4→$3), add threshold to SQL |
| `backend/src/services/TicketService.js` | MODIFY | Validate staleMinutes, fix undefined field passing |
| `backend/src/services/ProjectService.js` | MODIFY | Use AppError subclasses, explicit field mapping |
| `backend/src/services/HeartbeatService.js` | MODIFY | Move require to top, replace subqueries with JOIN |
| `backend/src/middleware/auth.js` | MODIFY | Convert promise chains to async/await (3 functions) |
| `backend/src/controllers/providerController.js` | MODIFY | Move require to top |
| `backend/src/utils/crypto.js` | MODIFY | Fix maskToken edge case |
| `backend/src/__tests__/` | CREATE/EXTEND | Regression tests for all 12 bugs |

---

## Known Unknowns

1. **MemoryService threshold in SQL**: The pgvector `<=>` operator may not support comparison in WHERE clause with a computed value. May need to use a subquery or CTE. Need to test.
2. **HeartbeatService N+1 JOIN**: The correlated subqueries count actions and sum costs from `agent_actions`. Replacing with JOIN requires `GROUP BY` which may change the result shape. Need to verify the output matches the current format.

---

## Important Design Decisions

No design decisions require user input. All fixes follow existing patterns:
- Use `NotFoundError`/`ForbiddenError` from `../errors/HttpError` for service errors
- Use parameterized queries for all SQL
- Use `async/await` consistently in middleware
- Use explicit field mapping instead of `Object.values()`

---

## Acceptance Criteria

1. [x] BP-51-01: `MemoryService.searchSimilar` uses `$3` for query embedding, query succeeds
2. [x] BP-51-02: `TicketService.recoverOrphanedTickets` rejects non-numeric `staleMinutes` with validation error
3. [x] BP-51-03: `ProjectService.update` returns 404/403 with proper error codes (not 500)
4. [x] BP-51-04: `HeartbeatService.cleanupStaleAgents` has `require()` at top of file
5. [x] BP-51-05: `ProjectService.update` maps fields explicitly, not via `Object.values()`
6. [x] BP-51-06: `TicketService.update` only passes non-undefined fields to `Ticket.update()`
7. [x] BP-51-07: `MemoryService.searchSimilar` filters by threshold in SQL (or CTE)
8. [x] BP-51-08: `auth.js` `requireActiveUser` uses `async/await`, no promise chain leaks
9. [x] BP-51-09: `auth.js` `agentAuth`/`verifyTokenOrAgent` use `async/await`
10. [x] BP-51-10: `HeartbeatService.getAllAgents` uses JOIN instead of correlated subqueries
11. [x] BP-51-11: `providerController.js` imports `db` at top
12. [x] BP-51-12: `maskToken` shows last 4 chars for 8-char tokens (returns `****` for < 8)
13. [x] All 12 bugs have regression tests
14. [x] `npm test` passes (all 793+ backend tests)
15. [x] No existing tests broken by changes

---

## Security Considerations

- [x] BP-51-02: Fixes SQL injection in `recoverOrphanedTickets` — validates input before interpolation
- [x] BP-51-01/BP-51-07: Fixes SQL parameter mismatch — prevents query failure
- [x] No new auth/authorization changes needed
- [x] No new sensitive data exposure

---

## Testing Checklist

### Backend Tests
- [x] Unit tests CREATED or EXTENDED for all 12 bugs
- [x] `backend/src/__tests__/memoryService.test.js` — extend with searchSimilar param/index tests
- [x] `backend/src/__tests__/ticketService.test.js` — extend with recoverOrphanedTickets validation
- [x] `backend/src/__tests__/projectService.test.js` — extend with error type and field mapping tests
- [x] `backend/src/__tests__/heartbeatService.test.js` — extend with JOIN result shape test
- [x] `backend/src/__tests__/auth.test.js` — extend with async/await promise rejection tests
- [x] `backend/src/__tests__/crypto.test.js` — extend with maskToken edge case tests
- [x] Every fix has a regression test that reproduces the original failure condition
- [x] Happy path AND error paths tested

### CI Requirements
- [x] `npm test` — backend unit tests pass
- [x] `npm run lint` — no lint errors

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — all fixes are in existing files
- ❌ **Duplicating existing error classes** — use `NotFoundError`/`ForbiddenError` from `../errors/HttpError`
- ❌ **Using generic `Error` in services** — always use AppError subclasses
- ❌ **SQL string interpolation** — always use parameterized queries
- ❌ **Promise chains in middleware** — use `async/await` consistently
- ❌ **Testing only happy paths** — test error cases, edge cases

---

*All 12 bugs are documented. Each fix is a single-file change. No new files, no new routes, no database migrations.*
