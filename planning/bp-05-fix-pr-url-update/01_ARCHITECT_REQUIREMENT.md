# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-09-15
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P1
**Effort**: Small

---

## Requirement

The build agent creates a PR on GitHub but does NOT update the ticket's `pr_url` field in the database. This means the review agent cannot fetch the PR diff (it checks `pr_url` to validate a PR exists). Currently, a manual database update is required after every PR creation.

**Problem**: The `pr_url` column exists on the `tickets` table (migration 008) and the backend API supports updating tickets, but the agent never calls the update endpoint with the PR URL after creating it.

**Solution**: Extend the existing ticket update flow so the agent automatically sets `pr_url` after PR creation.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API route exists: `backend/src/api/tickets.js` — YES (`PUT /:ticketId`)
- [x] Controller exists: `backend/src/controllers/ticketController.js` — YES (`updateTicket`)
- [x] Service exists: `backend/src/services/TicketService.js` — YES (`update`)
- [x] Model exists: `backend/src/models/ticket.js` — YES (`update`)
- [x] Validator exists: `backend/src/validators/tickets.js` — YES
- [x] Route is mounted: `backend/src/api/v1/index.js` — YES
- [x] OpenAPI JSDoc annotations exist — YES

### Agent Check
- [x] ApiService exists: `agent/src/main/java/com/vibecode/agent/service/ApiService.java` — YES
- [x] TicketProcessor exists: `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` — YES
- [x] `updateTicketStatus` method already exists in ApiService — YES

### Key Insight

The backend `updateTicket` controller at line 43 only allows `['title', 'description', 'status', 'priority', 'assigneeId']`. We need to add `prUrl` to this list. The `TicketService.update` method at line 112-120 passes individual fields to `Ticket.update()`. We need to handle `prUrl` as a special case since it doesn't fit the existing parameter signature.

---

## Scope

### In Scope
- Add `prUrl` to allowed fields in `ticketController.js`
- Add `prUrl` handling in `TicketService.update()` 
- Add `updateTicketPrUrl(Long ticketId, String prUrl)` method to `ApiService.java`
- Call `updateTicketPrUrl` in `TicketProcessor.java` after PR creation
- Add unit test for prUrl update

### Out of Scope
- Frontend changes (not needed — the UI already displays pr_url)
- New database migrations (pr_url column already exists)
- New API endpoints (using existing PUT endpoint)
- Review agent changes (the review agent was already fixed in bp-04)
- PR auto-merge functionality

---

## Pending Scope Items to Present to User

No deferred improvements found in previous tickets that are relevant to this specific fix.

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/controllers/ticketController.js` | MODIFY | Add `prUrl` to allowedFields array |
| `backend/src/services/TicketService.js` | MODIFY | Handle `prUrl` in update method |
| `agent/src/main/java/com/vibecode/agent/service/ApiService.java` | MODIFY | Add `updateTicketPrUrl` method |
| `agent/src/main/java/com/vibecode/agent/service/TicketProcessor.java` | MODIFY | Call `updateTicketPrUrl` after PR creation |

---

## Known Unknowns

1. **None** — The fix is straightforward: extend existing code.

---

## Important Design Decisions

No design decisions require user input. All choices follow existing patterns.

---

## Acceptance Criteria

1. [ ] The `prUrl` field can be updated via `PUT /api/v1/tickets/:ticketId`
2. [ ] The agent's `updateTicketPrUrl` method successfully updates the ticket's `pr_url` in the database
3. [ ] After creating a PR, the ticket's `pr_url` field is automatically set
4. [ ] The review agent can fetch the PR diff without manual DB updates
5. [ ] Backend unit tests pass
6. [ ] Agent compiles successfully (`mvn package -DskipTests -B`)
7. [ ] `npm run lint` passes (backend)
8. [ ] **Coverage threshold (60%)**: `npm run test:coverage` passes

---

## Out of Scope

- Frontend UI changes
- New database columns or migrations
- New API endpoints
- PR auto-merge
- Comment posting to PRs (deferred to future ticket)

---

## Performance Considerations

- Single UPDATE query per ticket — no performance impact
- No N+1 queries
- No caching needed

---

## Security Considerations

- [x] Authentication required: YES (existing `verifyTokenOrAgent` middleware)
- [x] Authorization check: YES (existing permission check in controller)
- [x] Input validation: YES (prUrl is validated as a URL string)
- [x] Rate limiting: handled by existing middleware

---

## Testing Checklist

### Backend Tests
- [ ] Unit test: `backend/src/__tests__/ticketPrUrl.test.js` — CREATED
- [ ] Test: PUT /tickets/:id with prUrl updates database
- [ ] Test: PUT /tickets/:id without prUrl still works (backward compatible)
- [ ] Test: Agent API key can update prUrl

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run test:coverage` — backend coverage threshold passes (60%)
- [ ] `npm run lint` — no lint errors
- [ ] Agent: `mvn package -DskipTests -B` — compiles successfully

---

## Anti-Patterns to Avoid

- ❌ Creating new files when existing ones can be extended
- ❌ Creating new API endpoints when existing PUT works
- ❌ Skipping the prUrl field in the agent's flow
- ❌ Hardcoding the PR URL format (use the value returned by GitHub API)

---

*The fix is targeted: 3 backend files modified, 0 new files created, 0 migrations needed.*
