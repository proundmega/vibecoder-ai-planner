# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The build agent creates a PR on GitHub but never updates the ticket's `pr_url` field. This creates a gap: the review agent cannot find the PR to review because it checks `pr_url` to validate a PR exists. Currently, every PR creation requires a manual `UPDATE tickets SET pr_url = '...' WHERE id = ...` command.

---

## Current State

### Existing Backend
- `PUT /api/v1/tickets/:ticketId` — updates ticket fields (title, description, status, priority, assigneeId)
- `TicketService.update()` — handles field validation and calls `Ticket.update()`
- `tickets` table has `pr_url TEXT` column (added in migration 008)
- `Ticket` model maps `pr_url` ↔ `prUrl`

### Existing Agent
- `ApiService.updateTicketStatus(ticketId, status)` — updates ticket status
- `TicketProcessor.processTicket()` — creates PR but doesn't update `pr_url`
- `GitHubService.createPullRequest()` — returns PR URL string

### Gap Analysis
The controller's `allowedFields` array at line 43 of `ticketController.js` does not include `prUrl`. The `TicketService.update()` method at line 112-120 only passes 6 parameters to `Ticket.update()`. The agent has no method to update the ticket with a PR URL.

---

## Design

### Option A: Extend Existing PUT Endpoint (Recommended)

Add `prUrl` to the allowed fields in the controller and handle it in the service.

**Changes to `ticketController.js`:**
```javascript
// Line 43: Add 'prUrl' to allowed fields
const allowedFields = ['title', 'description', 'status', 'priority', 'assigneeId', 'prUrl'];
```

**Changes to `TicketService.js`:**
```javascript
// In update() method: handle prUrl as a special case
// After the existing validation, if prUrl is present, update it via raw SQL
if (data.prUrl !== undefined) {
  await pool.query(
    'UPDATE tickets SET pr_url = $1, updated_at = NOW() WHERE id = $2',
    [data.prUrl, id]
  );
}
// Don't pass prUrl to Ticket.update() since it doesn't support it
```

**Changes to `ApiService.java`:**
```java
public void updateTicketPrUrl(Long ticketId, String prUrl) throws IOException {
    String url = baseUrl + "/tickets/" + ticketId;
    Map<String, String> body = Map.of("prUrl", prUrl);
    executePut(url, body, new TypeReference<ApiResponse<Object>>() {});
}
```

**Changes to `TicketProcessor.java`:**
```java
// After PR creation (line 157), add:
if (prUrl != null) {
    apiService.updateTicketPrUrl(pickedUp.getId(), prUrl);
    log.info("Updated ticket {} pr_url to {}", pickedUp.getId(), prUrl);
}
```

### Why Option A over Alternatives

| Alternative | Why Not |
|-------------|---------|
| New API endpoint `/tickets/:id/pr-url` | Unnecessary — existing PUT already handles updates |
| Direct DB update in agent | Violates separation of concerns — agent should use API |
| Modify `Ticket.update()` signature | Would require changing all callers — more risky |

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/controllers/ticketController.js` | MODIFY | Add `'prUrl'` to `allowedFields` array (line 43) |
| `backend/src/services/TicketService.js` | MODIFY | Handle `prUrl` in `update()` method — raw SQL UPDATE |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | Add `updateTicketPrUrl(Long, String)` method |
| `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` | MODIFY | Call `updateTicketPrUrl` after PR creation |

---

## Data Flow Diagram

```
[TicketProcessor] → [ApiService.updateTicketPrUrl] → [PUT /api/v1/tickets/:id]
       ↓                        ↓                           ↓
   "Created PR: url"      body: {prUrl: url}      [verifyTokenOrAgent]
                                  ↓                        ↓
                            [TicketController]      [TicketService.update]
                                  ↓                        ↓
                            allowedFields check    Raw SQL: UPDATE tickets
                                  ↓                        ↓
                            Filter prUrl           SET pr_url = $1 WHERE id = $2
                                  ↓                        ↓
                            TicketService.update() ←─── RETURN success
```

---

## Dependencies

### Backend Dependencies
- Existing `PUT /api/v1/tickets/:ticketId` endpoint
- Existing `verifyTokenOrAgent` middleware (agents can update their own tickets)
- Existing `pr_url` column on `tickets` table

### Agent Dependencies
- Existing `executePut` method in ApiService
- Existing `updateTicketStatus` pattern for reference

### Cross-Cutting Dependencies
- None — this is a self-contained fix

---

## Config / Environment Changes

- No new environment variables
- No new database migrations
- No new npm dependencies

---

## Database Changes

No database changes needed. The `pr_url` column already exists (migration 008).

---

## Security Considerations

- Existing `verifyTokenOrAgent` middleware handles authentication
- Existing permission check in `updateTicket` controller ensures only the ticket owner or users with `TICKET_UPDATE` permission can update
- Agents can only update their own tickets (check at line 33 of ticketController.js)
- `prUrl` is validated as a string — no SQL injection risk (parameterized query in service)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/ticketPrUrl.test.js` | prUrl update via PUT endpoint |
| Agent compile | Maven | `agent/` | Java compilation succeeds |

### Backend Unit Tests
- `backend/src/__tests__/ticketPrUrl.test.js` — CREATED
  - Test: PUT /tickets/:id with `prUrl` updates `pr_url` in DB
  - Test: PUT /tickets/:id without `prUrl` still works (backward compatible)
  - Test: Agent API key can update `prUrl` on their own ticket
  - Test: Agent cannot update `prUrl` on another agent's ticket

---

## Risks and Edge Cases

### Risks
- **[Risk]**: `TicketService.update()` passes data to `Ticket.update()` which doesn't know about `prUrl`
  - **Mitigation**: Handle `prUrl` separately with raw SQL before calling `Ticket.update()`, then filter it out

- **[Risk]**: Agent calls `updateTicketPrUrl` before PR is fully created on GitHub
  - **Mitigation**: Order is correct — PR creation happens first (line 157), then prUrl update (new line 158+)

### Edge Cases
- **Empty prUrl**: Service should allow `null`/empty prUrl (for tickets without PRs)
- **Invalid URL format**: No validation needed — GitHub API returns valid URLs
- **Concurrent updates**: Not a concern — agent is the only writer

---

## Alternative Designs Considered

### Alternative 1: New API endpoint `/tickets/:id/pr-url`
- **Pros**: Cleaner separation of concerns
- **Cons**: Unnecessary new endpoint — existing PUT already handles updates
- **Decision**: Option A is better — less code, follows existing patterns

### Alternative 2: Modify `Ticket.update()` signature
- **Pros**: Centralized update logic
- **Cons**: Would require changing all callers (claim, assign, etc.) — more risky
- **Decision**: Option A is better — targeted fix, minimal impact

---

## Pending Scope Items to Present to User

No deferred improvements found in previous tickets that are relevant to this specific fix.

---

## Specification Generation

This design is sufficient for implementation. The `04_SPECIFICATION.md` should list exact file paths and changes.

---

*The design extends existing code rather than creating new. This is the safest approach.*
