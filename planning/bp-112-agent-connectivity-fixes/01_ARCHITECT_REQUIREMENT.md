# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-08-08
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P0
**Effort**: Small

---

## Requirement

Fix four critical bugs discovered during Java agent connectivity testing that prevent the agent from completing its core ticket processing workflow. The agent cannot: (1) update ticket status due to a SQL NOT NULL violation, (2) fetch planning documents due to auth rejection, (3) send heartbeats due to ID type mismatch, and (4) view its own API key preview due to the same type mismatch.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API routes exist: `backend/src/api/` — YES
- [x] Controllers exist: `backend/src/controllers/` — YES
- [x] Services exist: `backend/src/services/` — YES
- [x] Models exist: `backend/src/models/` — YES
- [x] Middleware exists: `backend/src/middleware/auth.js` — YES
- [x] Routes are mounted: `backend/src/api/v1/index.js` — YES
- [x] OpenAPI JSDoc annotations exist — YES (partial)

### Key Insight

All four bugs are in existing backend code. No new files, routes, or endpoints need to be created. This is a pure bug fix — modify existing files only.

---

## Scope

### In Scope
- [ ] Fix `TicketService.update()` / `Ticket.update()` — don't pass `null` for undefined fields in SQL UPDATE
- [ ] Fix `/tickets/:id/planning` route — use `verifyTokenOrAgent` instead of `verifyToken`
- [ ] Fix heartbeat route ID comparison — use loose comparison (`!=`) instead of strict (`!==`)
- [ ] Fix agent key preview route — use loose comparison (`==`) instead of strict (`===`)
- [ ] Add regression tests for each fix

### Out of Scope
- Java agent code changes (GitHubService using wrong token — BUG 5, tracked separately)
- New API endpoints or routes
- Database migrations
- Frontend changes
- New npm dependencies
- Agent heartbeat data model changes

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-02, bp-99 | Java agent unit tests | Testing | bp-113-java-agent-tests | ☐ |
| 2 | bp-99 | Runtime provider config reload (agent restart required) | Agent Workflow | bp-114-agent-config-hot-reload | ☐ |
| 3 | bp-99 | GitHubService uses backend API key instead of GitHub token (BUG 5) | Bug Fix | bp-112-agent-connectivity-fixes | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-02, bp-99 | Java agent unit tests | Testing | bp-113-java-agent-tests |
| 2 | bp-99 | Runtime provider config reload | Agent Workflow | bp-114-agent-config-hot-reload |
| 3 | bp-99 | GitHubService uses backend API key instead of GitHub token | Bug Fix | bp-112-agent-connectivity-fixes |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/TicketService.js` | MODIFY | Fix null handling in update() method |
| `backend/src/models/ticket.js` | MODIFY | Fix null handling in update() static method |
| `backend/src/api/v1/index.js` | MODIFY | Change auth middleware on planning routes |
| `backend/src/api/v1/agentHeartbeat.js` | MODIFY | Fix ID type comparison |
| `backend/src/api/agents.js` | MODIFY | Fix ID type comparison |
| `backend/src/__tests__/api-ticket.test.js` | CREATE | Regression tests for ticket update fix |
| `backend/src/__tests__/api-agent-auth.test.js` | CREATE | Regression tests for planning/heartbeat auth |

---

## Known Unknowns

1. **Are there other routes using `verifyToken` that should accept agent auth?** — Scanned the codebase; planning and heartbeat are the two main gaps. Other agent-accessible routes already use `verifyTokenOrAgent` or `agentAuth`.
2. **Does the `null` handling in `Ticket.update()` affect other callers?** — Only affects `PUT /api/v1/tickets/:id` endpoint. The `PUT` body may contain only a subset of fields. Other callers (like status transitions via `updateStatus()`) use a different path.

---

## Important Design Decisions

No design decisions require user input. All choices follow existing patterns:
- Use `!=` / `==` for ID comparisons (consistent with other routes in the codebase that handle both string and numeric IDs)
- Use `undefined` sentinel for optional SQL UPDATE fields (consistent with the existing pattern in `Ticket.update()`)
- Use `verifyTokenOrAgent` for planning routes (consistent with other planning-related routes that already use it)

---

## Acceptance Criteria

1. [ ] `PUT /api/v1/tickets/:id` with `{"status":"review"}` succeeds without SQL error (was: NOT NULL violation)
2. [ ] `GET /api/v1/tickets/:id/planning` works with `X-API-Key` header (was: "Missing authentication token")
3. [ ] `POST /api/v1/agents-status/:id/heartbeat` works with valid `X-API-Key` (was: "Invalid API key for this agent")
4. [ ] `GET /api/v1/agents/:id/key` returns correct key preview with valid agent auth (was: "None")
5. [ ] Regression tests added and passing for all four fixes
6. [ ] Backend `npm test` passes
7. [ ] Backend `npm run lint` passes
8. [ ] Backend `npm run test:coverage` passes (60% minimum)

---

## Out of Scope

- Java agent code changes (BUG 5: GitHubService auth token)
- New API endpoints or routes
- Database migrations
- Frontend changes
- New npm dependencies
- Agent heartbeat data model changes
- Adding agent auth to other endpoints not identified in this ticket

---

## Performance Considerations

- No performance impact expected. All changes are logic fixes, not architectural changes.
- The `!=` / `==` comparison change has negligible performance difference from `!==` / `===`.

---

## Security Considerations

- [x] Authentication required: YES — all endpoints already require auth; we're expanding agent access to planning, not weakening it
- [x] Authorization check: YES — `verifyTokenOrAgent` already enforces agent identity
- [x] Input validation: YES — existing Joi schemas unchanged
- [x] No new sensitive data exposed

---

## Testing Checklist

### Test-First Requirement

- [ ] Empty test stub files created BEFORE any production code
- [ ] Test stubs contain imports, `describe` blocks, and stub `it` blocks
- [ ] After implementation: test stubs filled in with actual assertions

### Backend Tests
- [ ] Unit test file CREATED: `backend/src/__tests__/api-ticket-put.test.js` — test PUT ticket with status-only body
- [ ] Unit test file CREATED: `backend/src/__tests__/api-agent-auth.test.js` — test planning and heartbeat with X-API-Key
- [ ] Every new test covers: happy path AND error path
- [ ] Regression test for each of the 4 bugs
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run test:integration` — backend integration tests pass

---

## Anti-Patterns to Avoid

- ❌ Creating new files when existing ones can be extended
- ❌ Adding database migrations for logic fixes
- ❌ Changing the agent auth model (use existing `verifyTokenOrAgent`)
- ❌ Testing only happy paths — must test the exact failure conditions from the bug report
- ❌ Skipping the bash integration suite for backend API changes
