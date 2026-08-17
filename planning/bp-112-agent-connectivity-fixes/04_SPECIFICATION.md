# 04_SPECIFICATION.md — Model Execution Spec

**Use this file when a small model (7B–34B) will execute the ticket.**  
This file bridges the planning docs (01–03) and the code. It specifies exact file operations, imports, function signatures, test expectations, and edge cases. The model should not need to make any architecture decisions — those are already encoded here.

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model
**Date**: 2026-08-08

---

## Test-First Requirement

**Test stub files MUST be created before any production code.** This prevents the model from skipping tests.

The model MUST:
1. Create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) for every test file listed in "Test Expectations" below
2. Create **production code files** (implementation)
3. Fill in the test stubs with actual assertions

Only after all test stubs exist as empty files may the model begin implementing production code.

---

## File Operations

### CREATE: `backend/src/__tests__/api-ticket-put.test.js`

**Imports**:
```javascript
const request = require('supertest');
const app = require('../../index');
```

**Describe blocks**:
```javascript
describe('PUT /api/v1/tickets/:id — status-only body', () => {
  it('should return 200 with status-only body (regression: was SQL NOT NULL violation)', async () => {
    // stub
  });
  
  it('should return 200 with full body including title', async () => {
    // stub
  });
  
  it('should preserve existing title when not included in body', async () => {
    // stub
  });
  
  it('should return 400 with invalid status transition', async () => {
    // stub
  });
});
```

### CREATE: `backend/src/__tests__/api-agent-auth.test.js`

**Imports**:
```javascript
const request = require('supertest');
const app = require('../../index');
```

**Describe blocks**:
```javascript
describe('GET /api/v1/tickets/:id/planning — agent auth', () => {
  it('should return 200 with X-API-Key header (regression: was 401 Missing authentication token)', async () => {
    // stub
  });
  
  it('should return 200 with Bearer JWT token', async () => {
    // stub
  });
  
  it('should return 401 without any auth', async () => {
    // stub
  });
});

describe('POST /api/v1/agents-status/:id/heartbeat — agent auth', () => {
  it('should return 200 with valid X-API-Key (regression: was 403 Invalid API key for this agent)', async () => {
    // stub
  });
  
  it('should return 401 with invalid X-API-Key', async () => {
    // stub
  });
});
```

### MODIFY: `backend/src/services/TicketService.js`

**Position**: Lines 112-120

**Change**:
```javascript
// BEFORE:
return await Ticket.update(
  id,
  data.title !== undefined ? data.title : null,
  data.description !== undefined ? data.description : null,
  data.status !== undefined ? data.status : null,
  data.priority !== undefined ? data.priority : null,
  data.assigneeId !== undefined ? data.assigneeId : null,
  userId
);

// AFTER:
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

### MODIFY: `backend/src/api/v1/index.js`

**Position**: Lines 46, 47, 122, 178, 179, 180, 181

**Change**: Replace `verifyToken` with `verifyTokenOrAgent` on all planning routes.

```javascript
// BEFORE:
router.get('/tickets/:ticketId/planning', verifyToken, ...)
router.get('/tickets/:ticketId/planning/usage', verifyToken, ...)
router.get('/tickets/:ticketId/planning/:fileKey/usage', verifyToken, ...)
router.get('/tickets/:ticketId/planning/:fileKey', verifyToken, ...)
router.put('/tickets/:ticketId/planning/:fileKey', verifyToken, ...)
router.post('/tickets/:ticketId/planning/apply-template', verifyToken, ...)
router.patch('/tickets/:ticketId/planning/status', verifyToken, ...)

// AFTER:
router.get('/tickets/:ticketId/planning', verifyTokenOrAgent, ...)
router.get('/tickets/:ticketId/planning/usage', verifyTokenOrAgent, ...)
router.get('/tickets/:ticketId/planning/:fileKey/usage', verifyTokenOrAgent, ...)
router.get('/tickets/:ticketId/planning/:fileKey', verifyTokenOrAgent, ...)
router.put('/tickets/:ticketId/planning/:fileKey', verifyTokenOrAgent, ...)
router.post('/tickets/:ticketId/planning/apply-template', verifyTokenOrAgent, ...)
router.patch('/tickets/:ticketId/planning/status', verifyTokenOrAgent, ...)
```

**Note**: `verifyTokenOrAgent` must be imported from `../../middleware/auth`. Check current imports — if it's not already imported, add it.

### MODIFY: `backend/src/api/v1/agentHeartbeat.js`

**Position**: Line 49

**Change**:
```javascript
// BEFORE:
if (!agent || agent.id !== Number(req.params.id)) {

// AFTER:
if (!agent || agent.id != Number(req.params.id)) {
```

### MODIFY: `backend/src/api/agents.js`

**Position**: Line 285

**Change**:
```javascript
// BEFORE:
const agent = agents.find(a => a.id === req.params.agentId);

// AFTER:
const agent = agents.find(a => a.id == req.params.agentId);
```

---

## Test Expectations

### Backend Unit Tests — Ticket PUT

```
✓ [happy] PUT /api/v1/tickets/1 with {"status":"review"} returns 200
✓ [happy] PUT /api/v1/tickets/1 with {"status":"review","title":"New"} returns 200
✓ [happy] PUT /api/v1/tickets/1 with {"status":"review"} preserves existing title in DB
✓ [error] PUT /api/v1/tickets/1 with {"status":"done"} returns 400 (invalid transition from backlog)
```

**Minimum**: 1 happy + 1 error per scenario.

### Backend Unit Tests — Agent Auth

```
✓ [happy] GET /api/v1/tickets/1/planning with X-API-Key returns 200
✓ [happy] GET /api/v1/tickets/1/planning with Bearer JWT returns 200
✓ [error] GET /api/v1/tickets/1/planning without auth returns 401
✓ [happy] POST /api/v1/agents-status/1/heartbeat with valid X-API-Key returns 200
✓ [error] POST /api/v1/agents-status/1/heartbeat with invalid X-API-Key returns 401
```

**Minimum**: 1 happy + 1 error per endpoint.

---

## Edge Cases to Handle

1. **Explicit null values**: If a user sends `{"title": null}` to clear the title, the field is excluded from SQL (pre-existing behavior). To clear a field, use a dedicated endpoint.
2. **String vs numeric IDs**: The `==` / `!=` fix handles both string and numeric IDs correctly. No edge case risk.
3. **Empty planning documents**: `GET /api/v1/tickets/:id/planning` returns empty array when no planning docs exist. This is unchanged by the fix.

---

## Existing Code Patterns to Follow

- Use `supertest` for HTTP testing (same as existing `backend/src/__tests__/` files)
- Use `require('../../index')` to get the Express app
- Use `async/await` with `request(app).METHOD(path).send(body).expect(status)`
- Test files go in `backend/src/__tests__/`
- Describe blocks use the format: `describe('Endpoint — description', () => { ... })`

---

## Pending Scope Items

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-02, bp-99 | Java agent unit tests | Testing | bp-113-java-agent-tests | ☐ |
| 2 | bp-99 | GitHubService uses backend API key instead of GitHub token (BUG 5) | Bug Fix | bp-112-agent-connectivity-fixes | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

---

## Files NOT to Change

- `backend/src/models/ticket.js` — already handles `undefined` correctly in `Ticket.update()`
- `backend/src/middleware/auth.js` — `verifyTokenOrAgent` already exists and works correctly
- `frontend/` — no frontend changes needed
- `agent/` — Java agent code changes (BUG 5) are tracked separately
