# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bp-122 — Code Cleanup (Dead Code, Verbose Signature, Unpinned Dependency)

**Status**: planned
**Priority**: P3
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-09-15
**Date completed**: {{DATE}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend + Agent
**Dependencies**: None (can be done before or after bp-05 merge)

---

### a) Purpose

Clean up three code quality issues introduced in PR #97:
1. Remove unreachable `createPullRequestRetry()` method from agent GitHubService
2. Refactor `Ticket.update()` from 8 positional parameters to options object pattern
3. Pin git version in Agent Dockerfile

---

### b) Actions

#### Implementation Order

1. **[Step 1] Remove dead code** — `agent/src/main/java/com/vibecode/agent/service/GitHubService.java`
   - Delete `createPullRequestRetry()` method entirely
   - Verify with `grep -r createPullRequestRetry` that no references remain
   - *Depends on*: nothing

2. **[Step 2] Refactor Ticket.update() signature** — `backend/src/models/ticket.js`
   - Change from `update(id, title, description, status, priority, assigneeId, _userId, prUrl)` to `update(id, { title, description, status, priority, assigneeId, prUrl })`
   - Update `TicketService.update()` caller to pass options object
   - *Depends on*: nothing

3. **[Step 3] Update tests** — `backend/src/__tests__/ticketService.test.js`
   - Update `Ticket.update` mock expectations to capture options object
   - *Depends on*: Step 2

4. **[Step 4] Pin git version** — `agent/Dockerfile`
   - Find available git version: `docker run --rm alpine:latest apk list --available git 2>/dev/null | grep git`
   - Replace `RUN apk add --no-cache git` with `RUN apk add --no-cache git=<version>`
   - *Depends on*: nothing

#### Phase 1: Agent (Dead Code + Dockerfile)

1. Remove `createPullRequestRetry()` from `GitHubService.java`
2. Pin git version in `agent/Dockerfile`

#### Phase 2: Backend (Signature Refactor)

1. Modify `ticket.js` — change `update()` signature to options object
2. Modify `TicketService.js` — update caller to pass options object
3. Modify `ticketService.test.js` — update test mocks

---

### c) Per-File Action Plan

#### `agent/src/main/java/com/vibecode/agent/service/GitHubService.java` (MODIFY)
- **Change**: Delete `createPullRequestRetry()` method entirely
- **Before**: Method exists (was only called by removed `deleteExistingPR()`)
- **After**: Method removed, 422 path either returns existing URL or throws
- **Position**: Around line 130-155 (exact line varies)
- **Verification**: `grep -r createPullRequestRetry agent/` returns nothing

#### `backend/src/models/ticket.js` (MODIFY)
- **Change**: Refactor `update()` signature from 8 positional params to `(id, options)`
- **Before**:
  ```javascript
  static async update(id, title, description, status, priority, assigneeId, _userId, prUrl) {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (title !== undefined) { sets.push(`title = $${idx}`); vals.push(title); idx++; }
    if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
    if (status !== undefined) { sets.push(`status = $${idx}`); vals.push(status); idx++; }
    if (priority !== undefined) { sets.push(`priority = $${idx}`); vals.push(priority); idx++; }
    if (assigneeId !== undefined) { sets.push(`assignee_id = $${idx}`); vals.push(assigneeId); idx++; }
    if (prUrl !== undefined) { sets.push(`pr_url = $${idx}`); vals.push(prUrl); idx++; }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const query = `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${idx}`;
    await pool.query(query, vals);
  }
  ```
- **After**:
  ```javascript
  static async update(id, { title, description, status, priority, assigneeId, prUrl }) {
    const sets = [];
    const vals = [];
    let idx = 1;
    if (title !== undefined) { sets.push(`title = $${idx}`); vals.push(title); idx++; }
    if (description !== undefined) { sets.push(`description = $${idx}`); vals.push(description); idx++; }
    if (status !== undefined) { sets.push(`status = $${idx}`); vals.push(status); idx++; }
    if (priority !== undefined) { sets.push(`priority = $${idx}`); vals.push(priority); idx++; }
    if (assigneeId !== undefined) { sets.push(`assignee_id = $${idx}`); vals.push(assigneeId); idx++; }
    if (prUrl !== undefined) { sets.push(`pr_url = $${idx}`); vals.push(prUrl); idx++; }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    const query = `UPDATE tickets SET ${sets.join(', ')} WHERE id = $${idx}`;
    await pool.query(query, vals);
  }
  ```

#### `backend/src/services/TicketService.js` (MODIFY)
- **Change**: Update `Ticket.update()` call to pass options object
- **Before**:
  ```javascript
  return await Ticket.update(
    id,
    data.title,
    data.description,
    data.status,
    data.priority,
    data.assigneeId,
    userId,
    prUrl
  );
  ```
- **After**:
  ```javascript
  return await Ticket.update(id, {
    title: data.title,
    description: data.description,
    status: data.status,
    priority: data.priority,
    assigneeId: data.assigneeId,
    prUrl,
  });
  ```

#### `backend/src/__tests__/ticketService.test.js` (MODIFY)
- **Change**: Update test mocks to capture options object
- **Before**: `Ticket.update.mockImplementation((...args) => { capturedArgs = args; return mockTicket; });`
- **After**: Same pattern works — `capturedArgs[1]` will be the options object instead of individual params
- **Specific tests to update**:
  - `'should pass prUrl to Ticket.update()'` — check `capturedArgs[1].prUrl` instead of `capturedArgs[7]`
  - `'should pass undefined for prUrl when not provided'` — check `capturedArgs[1].prUrl` instead of `capturedArgs[7]`
  - `'should pass null for prUrl when explicitly null'` — check `capturedArgs[1].prUrl` instead of `capturedArgs[7]`
  - `'should handle prUrl alongside other fields'` — check `capturedArgs[1].status` and `capturedArgs[1].prUrl` instead of `capturedArgs[3]` and `capturedArgs[7]`

#### `agent/Dockerfile` (MODIFY)
- **Change**: Pin git version
- **Before**: `RUN apk add --no-cache git`
- **After**: `RUN apk add --no-cache git=2.47.1-r0` (or whatever version is available)
- **Position**: Find the `apk add` line that installs git

---

### d) Dependencies

- None — all 3 items are independent
- Backend tests must pass after refactoring
- Agent must compile after dead code removal
- Dockerfile must build with pinned git version

---

### e) Risks/Edge Cases

- **[Risk]**: Hidden callers of `Ticket.update()` beyond `TicketService.update()`
  - **Mitigation**: `grep -r "Ticket\.update(" backend/` to verify only one caller

- **[Risk]**: Pinned git version not available in Alpine image
  - **Mitigation**: Check available versions before committing

- **[Edge case]**: None significant

---

### f) Testing

#### Backend Unit Tests
- [ ] `npm test` — all tests pass after signature refactor
- [ ] `npm run test:coverage` — coverage threshold passes (60%)

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] Agent: `mvn package -DskipTests -B` — compiles successfully

---

### g) Migration Notes

No migration needed.

---

### h) Files Changed

**Agent:**
```
agent/src/main/java/com/vibecode/agent/service/GitHubService.java  → MODIFY (remove createPullRequestRetry)
agent/Dockerfile                                                    → MODIFY (pin git version)
```

**Backend:**
```
backend/src/models/ticket.js                → MODIFY (refactor update() signature)
backend/src/services/TicketService.js        → MODIFY (update caller)
backend/src/__tests__/ticketService.test.js  → MODIFY (update test mocks)
```

---

### i) Code Review Checklist

- [ ] Dead code removal verified with grep
- [ ] Ticket.update() refactoring maintains same behavior
- [ ] All tests pass after signature refactor
- [ ] Git version pinned to available Alpine package version
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) — min 60% lines, functions, branches, statements

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
4. [ ] Agent: `mvn package -DskipTests -B` compiles successfully
5. [ ] Agent Dockerfile builds successfully

---

*Fill in all sections before starting implementation. Update status as work progresses.*
