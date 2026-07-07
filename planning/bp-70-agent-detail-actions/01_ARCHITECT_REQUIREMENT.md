# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-07
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Scope**: Frontend
**Priority**: P1
**Effort**: Medium

---

## Requirement

Users managing agents from the UI cannot delete agents, revoke API keys, or see their CRUD agent records (separate from heartbeat data). This ticket adds:

1. **AgentDetail actions**: Delete agent and Revoke API Key buttons with confirmation dialogs
2. **AgentList CRUD table**: Show CRUD agent records alongside heartbeat data using a tabbed interface

---

## Existing Infrastructure Audit

### Backend API Check
- [x] DELETE `/agents/:id` exists — `backend/src/api/agents.js` line 134 — **YES**
- [x] POST `/agents/revoke/:id` exists — `backend/src/api/agents.js` line 107 — **YES**
- [x] GET `/agents/` exists — returns CRUD agents — **YES**
- [x] PUT/PATCH `/agents/:id` for edit — **NO** (deferred)
- [x] Permissions: AGENT_DELETE (project_admin, super_admin), AGENT_REVOKE (super_admin only)
- [x] OpenAPI JSDoc annotations: YES for delete and revoke

### Frontend API Client Check
- [ ] DELETE `/agents/:id` client — **NO** — must add `deleteAgent()`
- [ ] POST `/agents/revoke/:id` client — **NO** — must add `revokeAgentKey()`
- [ ] GET `/agents/` client — **YES** — `listAgents()` exists but unused by AgentList

### Frontend UI Check
- [x] AgentDetail.vue exists — `frontend/src/views/AgentDetail.vue` — **YES** (but no action buttons)
- [x] AgentList.vue exists — `frontend/src/views/AgentList.vue` — **YES** (but shows heartbeat data only)
- [x] No existing confirm dialog component — must create inline or reusable pattern

### Key Insight

**This is a FRONTEND-ONLY task.** All backend APIs exist. The frontend needs new API client functions and UI enhancements to AgentDetail.vue and AgentList.vue.

---

## Scope

### In Scope
1. **AgentDetail.vue action buttons:**
   - Add "Revoke API Key" button (calls `POST /agents/revoke/:id`)
   - Add "Delete Agent" button (calls `DELETE /agents/:id`)
   - Confirmation dialogs before destructive actions
   - Success feedback and navigation back to /agents after delete
   - Permission-aware: hide buttons based on user role (AGENT_REVOKE = super_admin only)

2. **AgentList.vue CRUD agents table:**
   - Add tabbed interface: "Heartbeat" tab (existing) + "Agents" tab (new CRUD table)
   - CRUD table shows: Name, API Key Preview, Rate Limit, Created At
   - "View Details" link per row → /agents/:id
   - Use `listAgents()` API client

### Out of Scope
- Edit agent name (no backend API — requires new endpoint + AGENT_UPDATE permission)
- API key masking in list response (backend change — deferred)
- `project_agents` table migration (missing table — deferred)
- AgentList.vue heartbeat table redesign (keep as-is, add CRUD as tab)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `frontend/src/api/agents.js` | MODIFY | Add `deleteAgent()`, `revokeAgentKey()` |
| `frontend/src/views/AgentDetail.vue` | MODIFY | Add action buttons, confirm dialogs, permission checks |
| `frontend/src/views/AgentList.vue` | MODIFY | Add tabs, CRUD agents table, `listAgents` import |
| `backend/src/` | NONE | APIs already exist |
| `database` | NONE | No changes |
| `config` | NONE | No changes |

---

## Known Unknowns

1. **Permission visibility**: AGENT_REVOKE is super_admin only, but AGENT_DELETE allows project_admin. Should we show revoke to project_admin? → **Decision**: Hide revoke for project_admin (backend will return 403 anyway, but hide proactively for better UX)

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

- Buttons follow danger styling (red bg) for destructive actions
- Confirmation uses inline modal (follows AgentModal.vue pattern from bp-69)
- Tabbed interface follows existing patterns in Dashboard.vue and ProjectDetail.vue
- API key shown as preview (first 8 chars + `***`) — matches backend `/agents/:id/key` endpoint

---

## Acceptance Criteria

### AgentDetail Actions
1. [ ] [Frontend UI] AgentDetail.vue shows "Revoke API Key" button (visible to super_admin only)
2. [ ] [Frontend UI] AgentDetail.vue shows "Delete Agent" button (visible to super_admin and project_admin)
3. [ ] [Frontend UI] Clicking "Revoke API Key" shows confirmation dialog: "Are you sure you want to revoke the API key for [agent name]?"
4. [ ] [Frontend UI] Clicking "Delete Agent" shows confirmation dialog: "Are you sure you want to delete [agent name]? This cannot be undone."
5. [ ] [Frontend UI] Confirming revoke calls `revokeAgentKey()` API, shows success, refreshes detail
6. [ ] [Frontend UI] Confirming delete calls `deleteAgent()` API, navigates back to /agents
7. [ ] [Frontend UI] Canceling confirmation closes dialog without action
8. [ ] [Frontend UI] Error handling: shows error message if API call fails

### AgentList CRUD Table
9. [ ] [Frontend UI] AgentList.vue has tabs: "Heartbeat" (existing) and "Agents" (new)
10. [ ] [Frontend UI] "Agents" tab shows CRUD agents table with columns: Name, API Key Preview, Rate Limit, Created
11. [ ] [Frontend UI] Each row has "View Details" link to /agents/:id
12. [ ] [Frontend UI] API key preview shows first 8 chars + `***` (e.g., `ak_1234****`)
13. [ ] [Frontend UI] Loading state shows spinner while fetching agents
14. [ ] [Frontend UI] Empty state shows "No agents created yet." when list is empty

### General
15. [ ] [Frontend UI] Linting passes (`npm run lint`)
16. [ ] [Frontend UI] Typecheck passes (`npm run typecheck`)
17. [ ] [Frontend UI] Build passes (`npm run build`)

---

## Out of Scope

- Edit agent name (no backend API)
- API key masking in list response (backend change)
- `project_agents` table migration
- AgentList.vue heartbeat table redesign
- Backend permission changes

---

## Performance Considerations

- Expected load: minimal (agent management is infrequent)
- No N+1 queries risk
- No caching needed
- No pagination needed (agent count per user is small)

---

## Security Considerations

- [x] Authentication required: YES — all actions use `verifyTokenOrAgent`
- [x] Authorization check: YES — AGENT_DELETE (project_admin+), AGENT_REVOKE (super_admin only)
- [x] Input validation: Agent ID from route params (bigint)
- [x] Destructive actions: Confirmation dialogs required
- [x] Sensitive data: API key shown as preview only

---

## Testing Checklist

### Frontend Tests
- [ ] Unit tests: `frontend/src/__tests__/agents.test.js` — extend with `deleteAgent()`, `revokeAgentKey()` tests
- [ ] Component tests: `frontend/cypress/component/AgentDetail.cy.ts` — CREATED
  - Renders action buttons (conditionally based on permissions)
  - Confirm dialog shows on button click
  - Confirm calls API and handles response
  - Cancel closes dialog
- [ ] Component tests: `frontend/cypress/component/AgentList.cy.ts` — extend with tabs
  - Both tabs render correctly
  - CRUD table shows correct columns
  - "View Details" links navigate correctly
- [ ] Loading, error, and confirmation states tested

### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ Creating new API clients from scratch — use `del` and `post` from `./client`
- ❌ Ignoring permission checks — check user role before showing buttons
- ❌ Hardcoding API paths — use the same pattern as existing API clients
- ❌ Skipping confirmation for destructive actions — always confirm delete/revoke
- ❌ Testing only happy paths — test error cases, permission denial
- ❌ Creating new pages when extending existing is better — add tabs to AgentList, don't create new page

---

*Fill in all sections before starting implementation.*
