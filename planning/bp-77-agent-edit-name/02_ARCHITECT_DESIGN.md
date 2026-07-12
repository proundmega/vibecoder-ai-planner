# 02_ARCHITECT_DESIGN.md — Agent Edit Name Design

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend + Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Agent names cannot be edited after creation. Users create agents with placeholder names (e.g., "Agent 1") and need to rename them. Currently, the only way to change an agent's name is to delete and recreate it (which revokes the API key).

---

## Current State

### Existing Backend
- `POST /api/agents/create` — creates agent with name
- `GET /api/agents` — lists user's agents
- `POST /api/agents/revoke/:agentId` — revokes API key
- `DELETE /api/agents/:agentId` — deletes agent
- **No PUT/PATCH endpoint for updating agent name**

### Existing Frontend
- `AgentList.vue` — displays agents in a table
- Each row shows: name, API key preview, status
- Actions: Delete, Revoke API key
- **No Edit button or edit mode**

### Gap Analysis
- Backend: No update endpoint for agents
- Frontend: No edit UI for agent names

---

## Design

### Option A: Inline Edit in AgentList (Recommended)

```
AgentList.vue changes:
  frontend/src/views/AgentList.vue
    → Add "edit" state variable per agent (editingAgentId)
    → Add "editName" input field when editing
    → Show edit icon/button next to agent name
    → On edit click: set editingAgentId, focus input
    → On save: call API, update local state, clear editingAgentId
    → On cancel: clear editingAgentId

Backend changes:
  backend/src/api/agents.js
    → Add PUT /:agentId route
    → Validate name (1-100 chars)
    → Verify agent belongs to user
    → Call AgentService.updateName()
```

### Option B: Modal Dialog
- Click edit → opens modal with name input
- More complex, adds new component
- Overkill for a single-field edit

### Option C: Context Menu
- Right-click agent → "Edit name"
- Less discoverable, non-standard UX
- Would require new context menu component

**Decision**: Option A — inline edit in AgentList. Simple, follows existing patterns, minimal new code.

---

## API Design

### PUT /api/agents/:agentId

**Request**:
```json
{
  "name": "New Agent Name"
}
```

**Response (200)**:
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "New Agent Name",
    "owner_id": "uuid",
    "api_key": "ak_***",
    "created_at": "2025-07-12T12:00:00.000Z"
  }
}
```

**Response (400)**:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "name must not exceed 100 characters"
  }
}
```

**Response (404)**:
```json
{
  "success": false,
  "error": {
    "code": "AGENT_NOT_FOUND",
    "message": "Agent not found"
  }
}
```

---

## Frontend Design

### AgentList.vue Edit Mode

```vue
<template>
  <tr v-for="agent in agents" :key="agent.id">
    <td>
      <!-- Normal mode: show name -->
      <span v-if="editingAgentId !== agent.id" @click="startEdit(agent)">
        {{ agent.name }}
        <EditIcon />
      </span>
      
      <!-- Edit mode: show input -->
      <form v-else @submit.prevent="saveEdit(agent)" @cancel="cancelEdit">
        <input 
          v-model="editName" 
          ref="editInput"
          :max-length="100"
        />
        <button type="submit" @click.stop="saveEdit(agent)">✓</button>
        <button type="button" @click.stop="cancelEdit">✗</button>
      </form>
    </td>
    <!-- ... other columns ... -->
  </tr>
</template>

<script setup>
const editingAgentId = ref(null)
const editName = ref('')
const editInput = ref(null)

function startEdit(agent) {
  editingAgentId.value = agent.id
  editName.value = agent.name
  nextTick(() => editInput.value?.focus())
}

function saveEdit(agent) {
  if (!editName.value.trim() || editName.value.length > 100) return
  await updateAgentName(agent.id, editName.value)
  // Update local state
  agent.name = editName.value
  editingAgentId.value = null
}

function cancelEdit() {
  editingAgentId.value = null
  editName.value = ''
}
</script>
```

---

## Testing Strategy

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Backend unit | Jest | `backend/src/__tests__/agentEdit.test.js` | updateName method, validation |
| API endpoint | Jest + supertest | `backend/src/__tests__/agentEditApi.test.js` | PUT response, auth, 404 |
| Frontend unit | Vitest | `frontend/src/__tests__/agentEdit.test.ts` | Edit mode, save, cancel |

### Bash Integration Suite

Add `backend/integration-test/suites/agent-edit.test.sh`:
```bash
# 1. Create agent
# 2. PUT /api/agents/:id with new name
# 3. Verify name updated
# 4. PUT with invalid name (>100 chars)
# 5. Verify 400 response
```

---

## Risks and Edge Cases

### Backend Risks
- **[Race condition]**: Two concurrent edits to same agent — Mitigation: Simple UPDATE, no complex logic
- **[Ownership check]**: User tries to edit another user's agent — Mitigation: WHERE clause includes owner_id

### Frontend Risks
- **[Input validation]**: Empty name submitted — Mitigation: Client-side validation (1-100 chars)
- **[Cancel during edit]**: User presses Escape — Mitigation: Add @keydown.escape handler

### Edge Cases
- **[Name with spaces]**: "My Agent" — Handle: Allow spaces, trim leading/trailing
- **[Name with special chars]**: "Agent #1 (Test)" — Handle: Allow any chars, just validate length
- **[Duplicate names]**: Two agents named "Test Agent" — Handle: Allow duplicates (no uniqueness constraint)

---

## Alternative Designs Considered

### Alternative 1: Modal Dialog
- **Pros**: Cleaner separation, more space for validation messages
- **Cons**: Adds new component, more code
- **Decision**: Inline edit is simpler and sufficient for single-field edit

### Alternative 2: Double-click to Edit
- **Pros**: More discoverable than single-click
- **Cons**: Non-standard for table cells
- **Decision**: Single-click edit icon is more explicit

---

## Pending Scope Items to Present to User

**MANDATORY**: Before presenting this ticket to the user, list all deferred improvements found in previous tickets' "Out of Scope" sections that are relevant to this ticket's domain. The user must be aware of follow-up work before approving implementation.

Common goldmine categories:
- **Security**: account lockout, API key rotation/expiry, IP whitelisting
- **Observability**: Prometheus metrics, log aggregation, distributed tracing
- **Infrastructure**: S3 migration, PgBouncer, CDN caching, cache warming
- **Developer experience**: migration dry-run, env var documentation generator
- **UX**: rate limit countdown UI, usage alerts, real-time billing dashboard
- **Testing**: Cypress component tests, integration test coverage gaps

### Items to Present

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|-------------|-------------|----------|----------------------|---------------|
| 1 | bp-71-account-lockout | Email notification on lockout | Security | bp-81-email-notifications | ☐ |
| 2 | bp-01-rate-limit-auth | Rate limit exceptions for whitelisted IPs (admin bypass) | Security | bp-73-ip-whitelisting | ☐ |
| 3 | fg-29-provider-config-api-key | API key rotation or expiry | Security | bp-74-api-key-rotation | ☐ |
| 4 | bp-07-structured-logging | Log aggregation pipeline (Datadog, CloudWatch) | Observability | bp-82-log-aggregation | ☐ |
| 5 | bp-14-ticket-planning | S3 integration (migrate planning files from filesystem to S3) | Infrastructure | bp-83-s3-migration | ☐ |

**If no deferred improvements are found, write: "No deferred improvements found in previous tickets."**

**All items above must be presented to the user before ticket approval.**

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file
- [ ] **Pending scope items presented to user**: All deferred improvements from previous tickets have been listed above and presented to the user

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
