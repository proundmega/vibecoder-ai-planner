# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Users cannot create agents. The AgentList page shows "No agents found." with no way to create one. The backend API and frontend API client exist but no UI wires them together.

---

## Current State

### Existing Backend
- `POST /api/v1/agents/create` — creates agent, returns `{ ...agent, generatedApiKey }`
- `GET /api/v1/agents/` — lists agents for user
- `DELETE /api/v1/agents/:id` — deletes agent
- `POST /api/v1/agents/revoke/:id` — revokes API key
- Auth: `verifyTokenOrAgent` + `AGENT_CREATE` permission required
- Validation: Joi schema (name: 1-100 chars, required)
- JSDoc OpenAPI annotations: YES

### Existing Frontend
- `frontend/src/api/agents.js` — `createAgent(name)` exists but unused
- `frontend/src/views/AgentList.vue` — shows heartbeat data, no create button
- `frontend/src/components/UserModal.vue` — modal pattern to follow
- `frontend/src/components/TicketEditModal.vue` — form pattern to follow
- `frontend/src/api/client.ts` — `post()` function with `extractData` unwrap

### Gap Analysis
- **Backend API**: Complete — no changes needed
- **Frontend API client**: Complete — `createAgent()` exists
- **Frontend UI**: Missing — no button, no modal, no wire-up
- **Result**: This is a frontend-only task

---

## Design

### Option A: Extend AgentList with Modal (Recommended)

Add a "Create Agent" button and modal to the existing AgentList page.

```
Modify AgentList.vue:
  frontend/src/views/AgentList.vue
    → Import createAgent from '@/api/agents'
    → Add showCreateModal ref
    → Add "Create Agent" button in header (after <h1>)
    → Add <AgentModal> component with v-model:show binding
    → Add handleCreate function: calls createAgent(), on success sets showCreateModal=false

Create AgentModal.vue:
  frontend/src/components/AgentModal.vue
    → Props: { show: Boolean }
    → Emits: ['update:show', 'created']
    → Form: name input (required, 1-100 chars)
    → Submit: calls parent's createAgent via emit('created', name)
    → Loading state: disable submit during API call
    → Error state: inline error message
    → CSS: .modal-overlay, .modal, .modal-actions, .btn-submit, .btn-cancel
```

### Why Option A over alternatives

| Alternative | Why Not |
|-------------|---------|
| New page for agent creation | Overkill for a single-field form |
| Inline form in AgentList | Would clutter the page; modal is cleaner |
| Create agent from AgentDetail | No agents exist yet to view details |

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/views/AgentList.vue` | MODIFY | Add import, button, modal, create handler |
| `frontend/src/components/AgentModal.vue` | CREATE | New modal component |
| `frontend/src/api/agents.js` | NONE | `createAgent()` already exists |
| `backend/src/` | NONE | No changes |
| `database` | NONE | No changes |

---

## Data Flow Diagram

```
[User] → [Click "Create Agent" button] → [AgentModal opens]
    ↓
[User enters name] → [Clicks Submit]
    ↓
[AgentModal emits 'created' with name]
    ↓
[AgentList calls createAgent(name)]
    ↓
[POST /api/v1/agents/create] → [Backend creates agent]
    ↓
[Response: { ...agent, generatedApiKey }]
    ↓
[AgentList: closeModal, show success]
```

### Frontend Data Flow
1. User clicks "Create Agent" button → `showCreateModal = true`
2. AgentModal renders with name input
3. User enters name, clicks Submit → `emit('created', name)`
4. AgentList calls `createAgent(name)` from `@/api/agents`
5. API client sends POST request with auth token
6. On success: modal closes, success message shown
7. On error: modal shows error message inline

### Error Handling Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| API client | HTTP error (400, 401, 403) | `.catch()` → error message shown in modal |
| Validation | Backend Joi validation | 400 with error message |
| Network | Connection failure | `.catch()` → generic error message |

---

## Dependencies

### Backend Dependencies
- `POST /api/v1/agents/create` — authentication via `verifyTokenOrAgent`, permission `AGENT_CREATE`
- `agents` table — already exists (migration 002)

### Frontend Dependencies
- `createAgent()` from `@/api/agents` — already exists
- `UserModal.vue` — pattern to follow for modal structure and CSS
- `TicketEditModal.vue` — pattern to follow for form handling

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
- [x] New endpoints require specific permissions: YES — `AGENT_CREATE` (project_admin, super_admin)
- [x] Input validated against: Joi schema (name: string, min 1, max 100)
- [x] Sensitive data in responses: API key returned at creation (shown once to user)

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Frontend unit | Vitest | `frontend/src/__tests__/agents.test.js` | API client calls |
| Component | Cypress | `frontend/cypress/component/AgentModal.cy.ts` | Modal render, form submit, error states |
| E2E | Cypress | `frontend/cypress/e2e/agent-create.cy.ts` | Full create flow |

### Frontend-Backend Contract Testing
- No response shape changes — existing `createAgent()` response already works

---

## Risks and Edge Cases

### Frontend Risks
- **[Modal z-index]**: Modal overlay must have higher z-index than page content → Use `z-index: 100` (follows UserModal)
- **[Escape key]**: User should be able to close modal with Escape → Add keydown listener

### Edge Cases
- [ ] **Empty name**: Backend rejects with 400 → Modal shows validation error
- [ ] **Name too long (>100 chars)**: Backend rejects with 400 → Modal shows error
- [ ] **Duplicate name**: Backend allows it (no uniqueness constraint) → No extra handling needed
- [ ] **Network failure**: API client `.catch()` → Modal shows generic error
- [ ] **Rapid clicks**: Submit button disabled during API call → Prevents duplicate requests

---

## Alternative Designs Considered

### Alternative 1: Inline form in AgentList
- **Pros**: Simpler, no modal component needed
- **Cons**: Clutters the page, doesn't scale if we add more fields later
- **Decision**: Modal is better — cleaner UX, follows existing patterns

### Alternative 2: Create agent from ProjectDetail AI tab
- **Pros**: Agents are used in AI context
- **Cons**: Agents are a global resource (not project-scoped), better managed from dedicated /agents page
- **Decision**: AgentList page is the right place

---

## Specification Generation

`04_SPECIFICATION.md` will be created with exact file operations for a small model to execute.

---

*This design document guides implementation.*
