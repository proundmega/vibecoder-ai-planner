# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bp-112 — Agent Connectivity Fixes

**Status**: planned
**Priority**: P0
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-08-08
**Date completed**: {{DATE}}
**PR**: {{link}}
**Branch**: `bp-112-agent-connectivity-fixes`
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Fix four critical bugs discovered during Java agent connectivity testing that prevent the agent from completing its core ticket processing workflow (pick up → process → update status to review).

---

### b) Actions

#### Implementation Order

1. **[Fix 1] TicketService.update() null handling** — `backend/src/services/TicketService.js`
   - Change `? data.field : null` to `? data.field : undefined` for all optional fields
   - *Depends on*: nothing

2. **[Fix 2] Planning auth middleware** — `backend/src/api/v1/index.js`
   - Change `verifyToken` to `verifyTokenOrAgent` on planning routes
   - *Depends on*: nothing

3. **[Fix 3] Heartbeat ID comparison** — `backend/src/api/v1/agentHeartbeat.js`
   - Change `!==` to `!=` on line 49
   - *Depends on*: nothing

4. **[Fix 4] Agent key preview ID comparison** — `backend/src/api/agents.js`
   - Change `===` to `==` on line 285
   - *Depends on*: nothing

5. **[Tests] Regression tests** — `backend/src/__tests__/api-ticket-put.test.js` + `api-agent-auth.test.js`
   - Create test stubs, then fill in assertions
   - *Depends on*: Fixes 1-4 (tests verify the fixes work)

---

### c) Per-File Action Plan

#### `backend/src/services/TicketService.js` (MODIFY)

**Lines 112-120**: Change null sentinel to undefined

```javascript
// BEFORE (broken):
return await Ticket.update(
  id,
  data.title !== undefined ? data.title : null,
  data.description !== undefined ? data.description : null,
  data.status !== undefined ? data.status : null,
  data.priority !== undefined ? data.priority : null,
  data.assigneeId !== undefined ? data.assigneeId : null,
  userId
);

// AFTER (fixed):
return await Ticket.update(
  id,
  data.title != null ? data.title : undefined,
  data.description != null ? data.description : undefined,
  data.status != null ? data.status : undefined,
  data.priority != null ? data.priority : undefined,
  data.assigneeId != null ? data.assigneeId : undefined,
  userId
);
```

**Why**: `Ticket.update()` checks `if (field !== undefined)` to decide whether to include a field in the SQL SET clause. Passing `undefined` excludes the field. Passing `null` includes it as `field = NULL`, violating NOT NULL constraints.

---

#### `backend/src/api/v1/index.js` (MODIFY)

**Lines 46, 47, 122, 178, 179, 180, 181**: Change `verifyToken` to `verifyTokenOrAgent`

```javascript
// BEFORE (broken):
router.get('/tickets/:ticketId/planning', verifyToken, ...)
router.get('/tickets/:ticketId/planning/usage', verifyToken, ...)
router.get('/tickets/:ticketId/planning/:fileKey/usage', verifyToken, ...)
router.get('/tickets/:ticketId/planning/:fileKey', verifyToken, ...)
router.put('/tickets/:ticketId/planning/:fileKey', verifyToken, ...)
router.post('/tickets/:ticketId/planning/apply-template', verifyToken, ...)
router.patch('/tickets/:ticketId/planning/status', verifyToken, ...)

// AFTER (fixed):
router.get('/tickets/:ticketId/planning', verifyTokenOrAgent, ...)
router.get('/tickets/:ticketId/planning/usage', verifyTokenOrAgent, ...)
router.get('/tickets/:ticketId/planning/:fileKey/usage', verifyTokenOrAgent, ...)
router.get('/tickets/:ticketId/planning/:fileKey', verifyTokenOrAgent, ...)
router.put('/tickets/:ticketId/planning/:fileKey', verifyTokenOrAgent, ...)
router.post('/tickets/:ticketId/planning/apply-template', verifyTokenOrAgent, ...)
router.patch('/tickets/:ticketId/planning/status', verifyTokenOrAgent, ...)
```

**Why**: Agents authenticate with `X-API-Key`, not JWT. `verifyTokenOrAgent` (from `middleware/auth.js`) accepts both.

---

#### `backend/src/api/v1/agentHeartbeat.js` (MODIFY)

**Line 49**: Change `!==` to `!=`

```javascript
// BEFORE (broken):
if (!agent || agent.id !== Number(req.params.id)) {

// AFTER (fixed):
if (!agent || agent.id != Number(req.params.id)) {
```

**Why**: `agent.id` from the DB may be a string `"1"`. `Number("1")` is `1`. Strict `!==` fails when types differ but values match.

---

#### `backend/src/api/agents.js` (MODIFY)

**Line 285**: Change `===` to `==`

```javascript
// BEFORE (broken):
const agent = agents.find(a => a.id === req.params.agentId);

// AFTER (fixed):
const agent = agents.find(a => a.id == req.params.agentId);
```

**Why**: `req.params.agentId` is always a string. `a.id` from the DB may be a number. Strict `===` fails when types differ.

---

### d) Dependencies

- `verifyTokenOrAgent` already exists in `backend/src/middleware/auth.js` — no new code needed
- `Ticket.update()` already handles `undefined` correctly by excluding from SET clause — no model changes needed

---

### e) Risks/Edge Cases

- **[Explicit null values]**: If a user sends `{"title": null}` to clear the title, this sets `title = NULL`. With the fix, `null != null` is `false`, so the field is excluded. This is a pre-existing limitation — not part of this ticket's scope.
- **[Type coercion]**: `==` / `!=` for ID comparisons is safe. Agent IDs are numeric (BIGSERIAL). No injection risk.

---

### f) Testing

#### Test-First Requirement

Create **empty test stub files** before production code:

1. `backend/src/__tests__/api-ticket-put.test.js` — stub file with imports, describe block, stub it blocks
2. `backend/src/__tests__/api-agent-auth.test.js` — stub file with imports, describe blocks, stub it blocks

Then fill in assertions after production code is written.

#### Backend Unit Tests

- [ ] Test file CREATED: `backend/src/__tests__/api-ticket-put.test.js`
  - `PUT /api/v1/tickets/:id` with `{"status":"review"}` succeeds (HTTP 200)
  - `PUT /api/v1/tickets/:id` with `{"status":"review","title":"New Title"}` succeeds
  - `PUT /api/v1/tickets/:id` with `{"status":"review"}` preserves existing title
  - `PUT /api/v1/tickets/:id` with invalid status returns 400

- [ ] Test file CREATED: `backend/src/__tests__/api-agent-auth.test.js`
  - `GET /api/v1/tickets/:id/planning` with `X-API-Key` returns 200
  - `GET /api/v1/tickets/:id/planning` with JWT returns 200
  - `GET /api/v1/tickets/:id/planning` without auth returns 401
  - `POST /api/v1/agents-status/:id/heartbeat` with valid `X-API-Key` succeeds
  - `POST /api/v1/agents-status/:id/heartbeat` with wrong `X-API-Key` returns 401

- [ ] Every new test covers: happy path AND error path
- [ ] **Coverage threshold (60%)**: `npm run test:coverage` — min 60% lines, functions, branches, statements

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] `npm run test:integration` — backend integration tests pass

---

### g) Migration Notes

None. All fixes are in application logic. No database changes.

---

### h) Files Changed

**Backend:**
```
backend/src/services/TicketService.js          → MODIFY (null → undefined sentinel)
backend/src/api/v1/index.js                    → MODIFY (verifyToken → verifyTokenOrAgent)
backend/src/api/v1/agentHeartbeat.js           → MODIFY (!== → !=)
backend/src/api/agents.js                      → MODIFY (=== → ==)
backend/src/__tests__/api-ticket-put.test.js   → CREATE (regression tests)
backend/src/__tests__/api-agent-auth.test.js   → CREATE (regression tests)
```

---

### Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-02, bp-99 | Java agent unit tests | Testing | bp-113-java-agent-tests | ☐ |
| 2 | bp-99 | GitHubService uses backend API key instead of GitHub token (BUG 5) | Bug Fix | bp-112-agent-connectivity-fixes | ☐ |

**All items above must be presented to the user before ticket approval.**

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (no new files, just bug fixes)
- [ ] Backend uses parameterized queries (unchanged — no SQL changes)
- [ ] Backend response format unchanged: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)` (unchanged)
- [ ] All tests written and passing — new test files CREATED
- [ ] **Coverage threshold enforced**: `npm run test:coverage` — min 60%
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes
3. [ ] Backend: `npm run lint` passes
4. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
5. [ ] `PUT /api/v1/tickets/:id` with `{"status":"review"}` returns 200 (was: 500)
6. [ ] `GET /api/v1/tickets/:id/planning` with `X-API-Key` returns 200 (was: 401)
7. [ ] `POST /api/v1/agents-status/:id/heartbeat` with valid `X-API-Key` returns 200 (was: 403)
8. [ ] `GET /api/v1/agents/:id/key` with valid agent auth returns correct preview (was: "None")
