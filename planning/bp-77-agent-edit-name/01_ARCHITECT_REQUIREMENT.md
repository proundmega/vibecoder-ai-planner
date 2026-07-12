# 01_ARCHITECT_REQUIREMENT.md — Edit Agent Name

**Status**: planned
**Date created**: 2025-07-12
**Date completed**: 
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Priority**: P2 (UX)
**Effort**: Small

---

## Requirement

Allow users to edit agent names. Currently, agents can be created and deleted but not updated. The name is set at creation time and cannot be changed. This is mentioned in both bp-69 and bp-70 "Out of Scope" sections.

---

## Existing Infrastructure Audit

### Backend API Check
- [x] Agent model exists: `backend/src/models/` — agents table with `name` column
- [x] Agent controller exists: `backend/src/api/agents.js` — CRUD endpoints for create, list, revoke, delete
- [x] Agent service exists: `backend/src/services/AgentService.js` — create, list, revoke, delete methods
- [x] No update/edit endpoint exists — **GAP**

### Frontend API Client Check
- [x] Frontend exists: `frontend/src/views/AgentList.vue` — agent list view
- [x] No edit name functionality — **GAP**

### Key Insight

The agents table has a `name` VARCHAR column. Adding edit requires:
1. Backend: PUT /api/agents/:agentId endpoint to update name
2. Frontend: Edit button in AgentList.vue that opens inline edit or modal
3. Validation: name must be 1-100 characters (same as create)

---

## Scope

### In Scope
- Backend: `PUT /api/agents/:agentId` endpoint to update agent name
- Backend: `AgentService.updateName(agentId, name)` method
- Backend: Joi validation for name (1-100 chars)
- Backend: Verify agent belongs to user (authorization)
- Frontend: Edit button in AgentList.vue next to agent name
- Frontend: Inline edit mode (click name → input field → save/cancel)
- Frontend: API client function `updateAgentName(agentId, name)`
- Tests: unit tests for backend endpoint, Vitest tests for frontend

### Out of Scope
- Edit agent API key (separate ticket — see bp-74)
- Edit agent rate limits (separate ticket)
- Edit agent avatar/icon (not currently supported)
- Bulk edit agents
- Audit log for name changes

---

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**All items above must be presented to the user before ticket approval.**

---

## Deferred Improvements Found (Internal Tracking)

| # | From Ticket | Improvement | Category | Suggested Next Ticket |
|---|-------------|-------------|----------|----------------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration |

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/agents.js` | MODIFY | Add PUT /:agentId route |
| `backend/src/services/AgentService.js` | MODIFY | Add updateName method |
| `backend/src/validators/agents.js` | MODIFY | Add updateAgentSchema (or extend createAgentSchema) |
| `frontend/src/api/agents.js` | MODIFY | Add updateAgentName function |
| `frontend/src/views/AgentList.vue` | MODIFY | Add edit button and inline edit mode |
| `frontend/src/__tests__/agentEdit.test.ts` | CREATE | Frontend unit tests |
| `backend/src/__tests__/agentEdit.test.js` | CREATE | Backend unit tests |

---

## Known Unknowns

1. **Should the backend endpoint be PUT or PATCH?** — Assumed PUT (full replacement of name). PATCH would be needed if we later add more updatable fields.
2. **Should name uniqueness be enforced?** — Assumed NO (multiple agents can have same name).

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation.

1. **PUT vs PATCH for agent update?** — PUT (simple, name is the only updatable field) — or PATCH (future-proof)? — {{PUT / PATCH}}

**If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."**

---

## Acceptance Criteria

1. [ ] [Backend API] `PUT /api/agents/:agentId` updates agent name
2. [ ] [Backend API] Name validation: 1-100 characters
3. [ ] [Backend API] Returns 404 if agent not found
4. [ ] [Backend API] Authorization: agent must belong to user
5. [ ] [Frontend UI] Edit button appears next to agent name in AgentList.vue
6. [ ] [Frontend UI] Clicking edit shows inline input field
7. [ ] [Frontend UI] Save/cancel buttons appear in edit mode
8. [ ] [Frontend Tests] Unit tests for API client function
9. [ ] [Frontend Tests] Unit tests for AgentList.vue edit mode
10. [ ] [Coverage] `npm run test:coverage` (backend) and `npm test -- --run --coverage` (frontend) pass (60% min)

---

## Out of Scope

- Edit agent API key (bp-74)
- Edit agent rate limits
- Edit agent avatar/icon
- Bulk edit agents
- Audit log for name changes

---

## Security Considerations

- [ ] Authorization: agent must belong to user (owner check)
- [ ] Input validation: name must be 1-100 characters
- [ ] No SQL injection (parameterized queries)

---

## Testing Checklist

### Backend Tests
- [ ] Unit tests: `backend/src/__tests__/agentEdit.test.js` — test updateName method
- [ ] API endpoint tests: test PUT /api/agents/:agentId
- [ ] Happy path AND error paths tested
- [ ] **Coverage threshold (60%)**: `npm run test:coverage`

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/agentEdit.test.ts` — test edit mode
- [ ] Component tests: test inline edit, save, cancel
- [ ] Loading, error, and empty states tested

---

*Fill in all sections before starting implementation.*
