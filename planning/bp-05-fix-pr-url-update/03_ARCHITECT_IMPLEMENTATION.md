# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: bp-05 — Fix PR URL Auto-Update After PR Creation

**Status**: planned
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-09-15
**Date completed**: {{DATE}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend
**Dependencies**: None

---

### a) Purpose

The build agent creates a PR on GitHub but doesn't update the ticket's `pr_url` field. This means the review agent cannot find the PR to review. This fix ensures the ticket's `pr_url` is automatically set after PR creation.

---

### b) Actions

#### Implementation Order

1. **[Step 1] Add prUrl to allowed fields** — `backend/src/controllers/ticketController.js`
   - Add `'prUrl'` to the `allowedFields` array at line 43
   - *Depends on*: nothing

2. **[Step 2] Handle prUrl in TicketService** — `backend/src/services/TicketService.js`
   - In `update()` method, extract `prUrl` from data before passing to `Ticket.update()`
   - If `prUrl` is present, execute raw SQL: `UPDATE tickets SET pr_url = $1, updated_at = NOW() WHERE id = $2`
   - *Depends on*: Step 1

3. **[Step 3] Add agent API method** — `agent/src/main/java/com/vibecode/agent/service/ApiService.java`
   - Add `updateTicketPrUrl(Long ticketId, String prUrl)` method
   - Follow pattern of `updateTicketStatus()` method
   - *Depends on*: nothing

4. **[Step 4] Call updateTicketPrUrl after PR creation** — `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java`
   - After line 158 (`log.info("Created PR: {}", prUrl)`), add:
     ```java
     if (prUrl != null) {
         apiService.updateTicketPrUrl(pickedUp.getId(), prUrl);
         log.info("Updated ticket {} pr_url to {}", pickedUp.getId(), prUrl);
     }
     ```
   - *Depends on*: Step 3

#### Phase 1: Backend

1. Modify `ticketController.js` — add `'prUrl'` to allowedFields
2. Modify `TicketService.js` — handle prUrl in update() method

#### Phase 2: Agent

1. Modify `ApiService.java` — add updateTicketPrUrl method
2. Modify `TicketProcessor.java` — call updateTicketPrUrl after PR creation

---

### c) Per-File Action Plan

#### `backend/src/controllers/ticketController.js` (MODIFY)
- **Change**: Line 43 — add `'prUrl'` to allowedFields array
- **Before**: `const allowedFields = ['title', 'description', 'status', 'priority', 'assigneeId'];`
- **After**: `const allowedFields = ['title', 'description', 'status', 'priority', 'assigneeId', 'prUrl'];`
- **Position**: Line 43

#### `backend/src/services/TicketService.js` (MODIFY)
- **Add**: Handle `prUrl` in `update()` method before calling `Ticket.update()`
- **Logic**: Extract `prUrl` from data, if present execute raw SQL UPDATE, then filter it out before passing to `Ticket.update()`
- **Position**: After line 110 (after all validations), before line 112 (Ticket.update call)
- **Code**:
  ```javascript
  // Handle prUrl separately (not part of Ticket.update signature)
  const prUrl = data.prUrl;
  if (prUrl !== undefined) {
    await pool.query(
      'UPDATE tickets SET pr_url = $1, updated_at = NOW() WHERE id = $2',
      [prUrl, id]
    );
  }
  ```

#### `agent/src/main/java/com/vibecode/agent/service/ApiService.java` (MODIFY)
- **Add method**: `updateTicketPrUrl(Long ticketId, String prUrl)`
- **Logic**: PUT request to `/tickets/{ticketId}` with body `{prUrl: prUrl}`
- **Position**: After `updateTicketStatus()` method (around line 95)
- **Code**:
  ```java
  public void updateTicketPrUrl(Long ticketId, String prUrl) throws IOException {
      String url = baseUrl + "/tickets/" + ticketId;
      Map<String, String> body = Map.of("prUrl", prUrl);
      ApiResponse<Object> response = executePut(url, body, new TypeReference<ApiResponse<Object>>() {});
      if (response.hasError()) {
          throw new IOException("Failed to update ticket pr_url: " + response.getError());
      }
  }
  ```

#### `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` (MODIFY)
- **Add**: Call `updateTicketPrUrl` after PR creation
- **Position**: After line 158 (`log.info("Created PR: {}", prUrl)`)
- **Code**:
  ```java
  if (prUrl != null) {
      apiService.updateTicketPrUrl(pickedUp.getId(), prUrl);
      log.info("Updated ticket {} pr_url to {}", pickedUp.getId(), prUrl);
  }
  ```

---

### d) Dependencies

- Backend: `PUT /api/v1/tickets/:id` endpoint (existing)
- Backend: `verifyTokenOrAgent` middleware (existing)
- Agent: `executePut` method in ApiService (existing)
- Agent: `updateTicketStatus` pattern (existing)

---

### e) Risks/Edge Cases

- **[Risk]**: `TicketService.update()` passes data to `Ticket.update()` which doesn't know about `prUrl`
  - **Mitigation**: Handle `prUrl` separately with raw SQL before calling `Ticket.update()`

- **[Edge case]**: Agent updates prUrl but PR creation failed
  - **Mitigation**: Order is correct — prUrl update only happens if `prUrl != null` (which is only set after successful PR creation)

---

### f) Testing

#### Backend Unit Tests
- [ ] Test controller: `backend/src/__tests__/ticketPrUrl.test.js` — CREATED
- [ ] Test: PUT /tickets/:id with prUrl updates database
- [ ] Test: PUT /tickets/:id without prUrl still works
- [ ] Test: Agent API key can update prUrl on their own ticket

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] Agent: `mvn package -DskipTests -B` — compiles successfully

---

### g) Migration Notes

No migration needed. `pr_url` column already exists (migration 008).

---

### h) Files Changed

**Backend:**
```
backend/src/controllers/ticketController.js  → MODIFY (add prUrl to allowedFields)
backend/src/services/TicketService.js        → MODIFY (handle prUrl in update())
```

**Agent:**
```
agent/src/main/java/com/vibecode/agent/service/ApiService.java       → MODIFY (add updateTicketPrUrl)
agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java  → MODIFY (call updateTicketPrUrl after PR)
```

**Tests:**
```
backend/src/__tests__/ticketPrUrl.test.js  → CREATE (new test file)
```

---

### i) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Agent follows existing ApiService patterns
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) — min 60% lines, functions, branches, statements

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run lint` passes
3. [ ] Backend: `npm run test:coverage` passes (60% min threshold)
4. [ ] Agent: `mvn package -DskipTests -B` compiles successfully
5. [ ] Create a test ticket, run build agent, verify `pr_url` is set automatically
6. [ ] Run review agent, verify it can fetch PR diff without manual DB update

---

*Fill in all sections before starting implementation. Update status as work progresses.*
