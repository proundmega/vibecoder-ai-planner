# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Users managing agents from the UI cannot delete agents, revoke API keys, or see their CRUD agent records. AgentDetail.vue shows heartbeat data but has no action buttons. AgentList.vue shows heartbeat data only — the CRUD agents table (from `GET /agents/`) is invisible to users.

---

## Current State

### Existing Backend
- `DELETE /api/v1/agents/:id` — deletes agent, requires `AGENT_DELETE` permission
- `POST /api/v1/agents/revoke/:id` — sets api_key to NULL, requires `AGENT_REVOKE` permission
- `GET /api/v1/agents/` — returns `{ agents: [...] }` with CRUD agent records
- `GET /api/v1/agents/:id/key` — returns key preview (`ak_1234***`)
- Permissions: AGENT_DELETE (project_admin, super_admin), AGENT_REVOKE (super_admin only)

### Existing Frontend
- `frontend/src/views/AgentDetail.vue` — shows heartbeat data, no action buttons
- `frontend/src/views/AgentList.vue` — shows heartbeat data only (uses `fetchAgentStatusList`)
- `frontend/src/api/agents.js` — has `listAgents()` but never imported by any view
- `frontend/src/api/client.ts` — has `del()` and `post()` functions
- `frontend/src/stores/auth.js` — `authStore.user.value?.role` for permission checks

### Gap Analysis
- **Backend API**: Complete for delete/revoke — no changes needed
- **Frontend API client**: Missing `deleteAgent()`, `revokeAgentKey()` — must add
- **Frontend UI**: Missing action buttons on AgentDetail, missing CRUD table on AgentList
- **Result**: Frontend-only task — add API client functions and UI enhancements

---

## Design

### Option A: Extend Existing Views (Recommended)

#### Part 1: AgentDetail.vue — Add Action Buttons

Add action buttons below the action history section, above the "Back to Agents" link.

```
Modify AgentDetail.vue:
  frontend/src/views/AgentDetail.vue
    → Import { del, post } from '@/api/client'
    → Import { useAuthStore } from '@/stores/auth'
    → Add authStore = useAuthStore()
    → Add revokeApiKey() function: calls POST /agents/revoke/:id
    → Add deleteAgent() function: calls DELETE /agents/:id
    → Add showRevokeConfirm / showDeleteConfirm refs
    → Add confirmation modals (inline, following AgentModal.vue pattern)
    → Add computed canRevoke = authStore.user.value?.role === 'super_admin'
    → Add computed canDelete = ['super_admin', 'project_admin'].includes(authStore.user.value?.role)
    → Add action buttons section before back-link
```

#### Part 2: AgentList.vue — Add CRUD Agents Tab

Add a tabbed interface alongside existing heartbeat view.

```
Modify AgentList.vue:
  frontend/src/views/AgentList.vue
    → Import { listAgents } from '@/api/agents'
    → Add activeTab ref: 'heartbeat' | 'agents'
    → Add tabs array: [{ id: 'heartbeat', label: 'Heartbeat' }, { id: 'agents', label: 'Agents' }]
    → Add agentsData ref (for CRUD agents list)
    → Add loadingAgents ref
    → Add loadAgents() function: calls listAgents()
    → Add CRUD agents table (Name, API Key Preview, Rate Limit, Created, Actions)
    → Add "View Details" link per row → /agents/:id
    → Add CSS for tabs (follow existing tab patterns)
```

### Why Option A over alternatives

| Alternative | Why Not |
|-------------|---------|
| New page for agent management | Overkill — AgentList and AgentDetail already serve as the management UI |
| Inline forms in AgentDetail | Buttons + confirm dialogs are cleaner than inline forms |
| Replace heartbeat table with CRUD table | Users need both views — heartbeat for monitoring, CRUD for management |

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/api/agents.js` | MODIFY | Add `deleteAgent()`, `revokeAgentKey()` |
| `frontend/src/views/AgentDetail.vue` | MODIFY | Add action buttons, confirm modals, permission checks |
| `frontend/src/views/AgentList.vue` | MODIFY | Add tabs, CRUD agents table, `listAgents` import |
| `backend/src/` | NONE | No changes |
| `database` | NONE | No changes |

---

## Data Flow Diagram

### AgentDetail Actions
```
[User] → [Click "Revoke API Key"] → [Confirmation modal opens]
    ↓
[User confirms] → [Call POST /agents/revoke/:id]
    ↓
[Backend sets api_key = NULL] → [Response: { message: "API key revoked" }]
    ↓
[Frontend: show success, refresh detail]

[User] → [Click "Delete Agent"] → [Confirmation modal opens]
    ↓
[User confirms] → [Call DELETE /agents/:id]
    ↓
[Backend deletes agent] → [Response: { message: "Agent deleted" }]
    ↓
[Frontend: navigate to /agents]
```

### AgentList CRUD Table
```
[User] → [Click "Agents" tab]
    ↓
[loadAgents() calls listAgents()]
    ↓
[GET /api/v1/agents/] → [Response: { agents: [...] }]
    ↓
[Frontend: render CRUD agents table]
```

### Error Handling Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| API client | HTTP error (400, 401, 403, 404) | Error message shown in modal or toast |
| Permission | 403 Forbidden | "You don't have permission to perform this action" |
| Network | Connection failure | Generic error message |

---

## Dependencies

### Backend Dependencies
- `DELETE /api/v1/agents/:id` — authentication + `AGENT_DELETE` permission
- `POST /api/v1/agents/revoke/:id` — authentication + `AGENT_REVOKE` permission
- `GET /api/v1/agents/` — authentication + `AGENT_READ` permission

### Frontend Dependencies
- `del()` from `@/api/client` — DELETE HTTP method
- `post()` from `@/api/client` — POST HTTP method
- `listAgents()` from `@/api/agents` — GET agents list
- `authStore.user.value?.role` — for permission checks
- `AgentModal.vue` pattern — for confirmation modals (from bp-69)

### Cross-Cutting Dependencies
- None — no OpenAPI spec changes, no generated types regeneration needed

---

## Config / Environment Changes
- [ ] New environment variables: NONE
- [ ] New database migrations: NONE
- [ ] New npm dependencies: NONE
- [ ] Existing config changes: NONE

---

## Database Changes
None.

---

## Security Considerations

- [x] New endpoints require authentication: YES — `verifyTokenOrAgent` middleware
- [x] New endpoints require specific permissions: YES — AGENT_DELETE (project_admin+), AGENT_REVOKE (super_admin only)
- [x] Input validated against: Agent ID from route params (bigint)
- [x] Destructive actions: Confirmation dialogs required before delete/revoke
- [x] Sensitive data: API key shown as preview only (first 8 chars + `***`)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/agents.test.js` | API client calls |
| Component | Cypress | `frontend/cypress/component/AgentDetail.cy.ts` | Action buttons, confirm dialogs |
| Component | Cypress | `frontend/cypress/component/AgentList.cy.ts` | Tabs, CRUD table |

### Frontend-Backend Contract Testing
- No response shape changes — existing API responses already work

---

## Risks and Edge Cases

### Frontend Risks
- **[Permission visibility]**: AgentDetail shows buttons based on role — if role changes, buttons should update → Use computed properties
- **[Race condition]**: User clicks delete while page is loading → Disable buttons during loading

### Edge Cases
- [ ] **Delete non-existent agent**: Backend returns 404 → Modal shows "Agent not found"
- [ ] **Revoke already-revoked key**: Backend succeeds (idempotent) → Show success
- [ ] **Delete while agent is active**: Backend deletes, FK cascade removes heartbeats → Navigate away immediately
- [ ] **Network failure during delete**: Modal shows error, stays on detail page
- [ ] **Permission denied (403)**: Modal shows "You don't have permission"
- [ ] **Rapid clicks**: Buttons disabled during API call → Prevents duplicate requests

---

## Alternative Designs Considered

### Alternative 1: Dropdown menu for actions
- **Pros**: Saves space, cleaner UI
- **Cons**: Actions are more discoverable as buttons; dropdowns hide functionality
- **Decision**: Buttons are better for discoverability

### Alternative 2: Inline confirmation (no modal)
- **Pros**: Simpler, fewer clicks
- **Cons**: Clutters the page, harder to read on small screens
- **Decision**: Modal is better — follows existing patterns, cleaner on mobile

### Alternative 3: Replace heartbeat table with CRUD table
- **Pros**: Simpler — one table instead of two
- **Cons**: Users need both views — heartbeat for monitoring, CRUD for management
- **Decision**: Tabbed interface preserves both views

---

## Specification Generation

`04_SPECIFICATION.md` has been created with exact file operations for a small model to execute.

---

*This design document guides implementation.*
