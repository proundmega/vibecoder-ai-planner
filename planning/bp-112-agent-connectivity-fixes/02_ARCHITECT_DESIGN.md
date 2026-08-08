# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Four bugs in the backend prevent the Java agent from completing its ticket processing workflow:

1. **BUG 1**: `PUT /api/v1/tickets/:id` with `{"status":"review"}` causes a SQL NOT NULL violation because `TicketService.update()` passes `null` for fields not present in the request body (title, description), and the model's SQL UPDATE includes them as `title = NULL`.

2. **BUG 2**: `GET /api/v1/tickets/:id/planning` uses `verifyToken` (JWT-only) middleware, rejecting `X-API-Key` authentication. The Java agent sends `X-API-Key` but gets "Missing authentication token".

3. **BUG 3**: `POST /api/v1/agents-status/:id/heartbeat` uses strict type comparison `agent.id !== Number(req.params.id)`. When `agent.id` is a string `"1"` (from DB) and `Number("1")` is `1`, the comparison fails even though the API key is valid.

4. **BUG 4**: `GET /api/v1/agents/:id/key` uses strict equality `a.id === req.params.agentId`. Since `req.params.agentId` is always a string, this fails when `a.id` is a number from the DB.

---

## Current State

### Existing Backend

- `TicketService.update()` (line 112-120) passes `data.title !== undefined ? data.title : null` — when `title` is not in the body, it passes `null` to `Ticket.update()`
- `Ticket.update()` (line 101) checks `if (title !== undefined)` — `null !== undefined` is `true`, so it includes `title = $1` with value `null` in the SQL SET clause
- `GET /tickets/:id/planning` route (line 46 of `v1/index.js`) uses `verifyToken` instead of `verifyTokenOrAgent`
- `POST /agents-status/:id/heartbeat` (line 49 of `agentHeartbeat.js`) uses `agent.id !== Number(req.params.id)` strict comparison
- `GET /agents/:agentId/key` (line 285 of `agents.js`) uses `a.id === req.params.agentId` strict comparison

### Gap Analysis

All four bugs are in existing code. No new files or routes needed. The fixes are:
1. Change null sentinel from `null` to `undefined` in TicketService.update()
2. Change middleware from `verifyToken` to `verifyTokenOrAgent` on planning routes
3. Change `!==` to `!=` on heartbeat ID comparison
4. Change `===` to `==` on agent key preview ID comparison

---

## Design

### Fix 1: TicketService.update() null handling

**File**: `backend/src/services/TicketService.js` line 112-120

**Current (broken)**:
```javascript
return await Ticket.update(
  id,
  data.title !== undefined ? data.title : null,
  data.description !== undefined ? data.description : null,
  data.status !== undefined ? data.status : null,
  data.priority !== undefined ? data.priority : null,
  data.assigneeId !== undefined ? data.assigneeId : null,
  userId
);
```

**Fix**:
```javascript
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

**Why**: `Ticket.update()` checks `if (field !== undefined)` to decide whether to include a field in the SQL SET clause. Passing `undefined` excludes the field entirely. Passing `null` includes it as `field = NULL`, violating NOT NULL constraints.

### Fix 2: Planning auth middleware

**File**: `backend/src/api/v1/index.js` line 46

**Current (broken)**:
```javascript
router.get('/tickets/:ticketId/planning', verifyToken, (req, res, next) => ...)
```

**Fix**:
```javascript
router.get('/tickets/:ticketId/planning', verifyTokenOrAgent, (req, res, next) => ...)
```

Also apply to lines 47, 122, 178, 179, 180, 181 (all planning-related routes).

**Why**: The Java agent authenticates with `X-API-Key`, not JWT. `verifyTokenOrAgent` accepts both.

### Fix 3: Heartbeat ID comparison

**File**: `backend/src/api/v1/agentHeartbeat.js` line 49

**Current (broken)**:
```javascript
if (!agent || agent.id !== Number(req.params.id)) {
```

**Fix**:
```javascript
if (!agent || agent.id != Number(req.params.id)) {
```

**Why**: `agent.id` from the DB may be a string `"1"` or number `1`. `Number(req.params.id)` is always a number. Strict `!==` fails when types differ but values match.

### Fix 4: Agent key preview ID comparison

**File**: `backend/src/api/agents.js` line 285

**Current (broken)**:
```javascript
const agent = agents.find(a => a.id === req.params.agentId);
```

**Fix**:
```javascript
const agent = agents.find(a => a.id == req.params.agentId);
```

**Why**: `req.params.agentId` is always a string. `a.id` from the DB may be a number. Strict `===` fails when types differ.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/TicketService.js` | MODIFY | Line 113-119: Change `? data.field : null` to `? data.field : undefined` |
| `backend/src/models/ticket.js` | NONE | No change needed — the model already handles `undefined` correctly by excluding from SET clause |
| `backend/src/api/v1/index.js` | MODIFY | Lines 46, 47, 122, 178, 179, 180, 181: Change `verifyToken` to `verifyTokenOrAgent` |
| `backend/src/api/v1/agentHeartbeat.js` | MODIFY | Line 49: Change `!==` to `!=` |
| `backend/src/api/agents.js` | MODIFY | Line 285: Change `===` to `==` |
| `backend/src/__tests__/api-ticket-put.test.js` | CREATE | Regression tests for ticket PUT with status-only body |
| `backend/src/__tests__/api-agent-auth.test.js` | CREATE | Regression tests for planning and heartbeat with X-API-Key |

---

## Data Flow Diagram

```
[Agent] --X-API-Key--> [Backend Route] --verifyTokenOrAgent--> [Controller] --[Service]--> [Database]
                                                                                       ^
                                                                                       |
                                                    FIX 1: Pass undefined, not null, for optional fields
                                                    FIX 3: Loose comparison for ID match
```

---

## Dependencies

### Backend Dependencies
- `TicketService.update()` depends on `Ticket.update()` — both must handle `undefined` correctly
- `verifyTokenOrAgent` is already implemented in `middleware/auth.js` — no new code needed
- `agentAuth` is already implemented in `middleware/auth.js` — no new code needed

### Cross-Cutting Dependencies
- None. All fixes are self-contained.

---

## Config / Environment Changes

- [ ] No new environment variables
- [ ] No new database migrations
- [ ] No new npm dependencies
- [ ] No existing config changes

---

## Database Changes

None. All fixes are in application logic.

---

## Security Considerations

- **Fix 2 (planning auth)**: Expanding agent access to planning routes. This is intentional — agents need to read planning documents to process tickets. No security regression.
- **Fixes 3 & 4 (ID comparison)**: No security impact. These are type coercion fixes, not auth changes.
- **Fix 1 (null handling)**: No security impact. This is a SQL correctness fix.

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/api-ticket-put.test.js` | PUT ticket with status-only body |
| Backend unit | Jest | `backend/src/__tests__/api-agent-auth.test.js` | Planning/heartbeat with X-API-Key |

### Test Cases

#### Ticket PUT with status-only body
- [ ] `PUT /api/v1/tickets/:id` with `{"status":"review"}` succeeds (was: SQL NOT NULL violation)
- [ ] `PUT /api/v1/tickets/:id` with `{"status":"review","title":"New Title"}` succeeds (full body)
- [ ] `PUT /api/v1/tickets/:id` with `{"status":"review"}` preserves existing title and description
- [ ] `PUT /api/v1/tickets/:id` with `{"title":null}` sets title to NULL (explicit null should work)

#### Planning endpoint with agent auth
- [ ] `GET /api/v1/tickets/:id/planning` with `X-API-Key` returns 200 (was: 401)
- [ ] `GET /api/v1/tickets/:id/planning` with JWT returns 200 (unchanged)
- [ ] `GET /api/v1/tickets/:id/planning` without auth returns 401

#### Heartbeat with valid API key
- [ ] `POST /api/v1/agents-status/:id/heartbeat` with valid `X-API-Key` succeeds (was: 403)
- [ ] `POST /api/v1/agents-status/:id/heartbeat` with wrong `X-API-Key` returns 401

#### Agent key preview
- [ ] `GET /api/v1/agents/:id/key` with valid agent auth returns correct key preview
- [ ] `GET /api/v1/agents/:id/key` with valid JWT returns correct key preview

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: Changing `!= null` to `!= null` in TicketService — what if a caller explicitly passes `null` to clear a field?
  **Mitigation**: `!= null` (loose null check) returns `false` for both `null` and `undefined`. If a caller explicitly wants to clear a field, they should pass `null` as the value, and `null != null` is `false`, so it would be treated as "don't include in SQL". This is correct behavior — to clear a field, use `COALESCE` in SQL or a dedicated endpoint. The current code already has this limitation.

- **[Risk]**: Changing `===` to `==` in agent key preview could match unexpected IDs.
  **Mitigation**: Agent IDs are numeric (BIGSERIAL). String-to-number coercion in `==` is safe here. No injection risk.

### Edge Cases
- **Explicit null values**: If a user sends `{"title": null}` to clear the title, this should set `title = NULL`. With the fix, `null != null` is `false`, so the field is excluded from SQL. This is a pre-existing limitation — to clear a field, use a dedicated endpoint. Not part of this ticket's scope.
- **String vs numeric IDs**: The `==` / `!=` fix handles both string and numeric IDs correctly.

---

## Alternative Designs Considered

### Alternative 1: Use COALESCE in SQL UPDATE
Instead of excluding undefined fields, use `COALESCE(title, title)` in the SET clause to preserve existing values.
- **Pros**: Cleaner SQL, no need to check for undefined
- **Cons**: More complex SQL, harder to debug, doesn't solve the core issue (we still need to decide which fields to update)
- **Decision**: Current approach (exclude undefined from SET) is simpler and follows existing patterns in the codebase.

### Alternative 2: Create a dedicated PATCH /status endpoint
Add a new endpoint for status-only updates.
- **Pros**: Cleaner API, no null-handling issues
- **Cons**: New endpoint, API surface grows, existing PUT endpoint still broken for other use cases
- **Decision**: Fix the existing PUT endpoint. It's the standard REST pattern and the fix is straightforward.

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain.

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-02, bp-99 | Java agent unit tests | Testing | bp-113-java-agent-tests | ☐ |
| 2 | bp-99 | GitHubService uses backend API key instead of GitHub token (BUG 5) | Bug Fix | bp-112-agent-connectivity-fixes | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 200 when status-only body sent")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user
