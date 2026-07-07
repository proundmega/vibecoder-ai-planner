# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Ticket**: bp-70 — Add agent delete/revoke actions and CRUD agents table

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-07-07
**Date completed**: {{DATE}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Users managing agents from the UI cannot delete agents, revoke API keys, or see their CRUD agent records. This ticket adds action buttons with confirmation dialogs to AgentDetail.vue, and a CRUD agents table with tabs to AgentList.vue.

---

### b) Actions

#### Implementation Order

1. **Add API client functions** — `frontend/src/api/agents.js`
   - Add `deleteAgent(agentId)` using `del()` from client
   - Add `revokeAgentKey(agentId)` using `post()` from client
   - *Depends on*: nothing

2. **Modify AgentDetail.vue** — `frontend/src/views/AgentDetail.vue`
   - Add action buttons (Revoke + Delete) with permission checks
   - Add confirmation modals for both actions
   - Wire up API calls
   - *Depends on*: Step 1

3. **Modify AgentList.vue** — `frontend/src/views/AgentList.vue`
   - Add tabbed interface (Heartbeat + Agents tabs)
   - Add CRUD agents table
   - Wire up `listAgents()` API
   - *Depends on*: Step 1

#### Phase 1: Frontend API Client

1. **Add `deleteAgent()` and `revokeAgentKey()`** — `frontend/src/api/agents.js`
   ```javascript
   export function deleteAgent(agentId) {
     return del(`/api/v1/agents/${agentId}`)
   }

   export function revokeAgentKey(agentId) {
     return post(`/api/v1/agents/revoke/${agentId}`)
   }
   ```

#### Phase 2: Frontend UI — AgentDetail

2. **Modify AgentDetail.vue** — add action buttons and confirm modals
   - Import `del`, `post` from `@/api/client`
   - Import `useAuthStore` from `@/stores/auth`
   - Import `deleteAgent`, `revokeAgentKey` from `@/api/agents`
   - Add permission computed properties
   - Add confirmation modal state refs
   - Add action handler functions
   - Add action buttons section + confirm modals in template
   - Add CSS for action buttons (danger styling)

#### Phase 3: Frontend UI — AgentList

3. **Modify AgentList.vue** — add tabs and CRUD table
   - Import `listAgents` from `@/api/agents`
   - Add tab state, agents data, loading state
   - Add `loadAgents()` function
   - Add tabs navigation in template
   - Add CRUD agents table panel
   - Add CSS for tabs and table

---

### c) Per-File Action Plan

#### `frontend/src/api/agents.js` (MODIFY)

**Add after line 25** (after `fetchAgentDetail`):
```javascript
export function deleteAgent(agentId) {
  return del(`/api/v1/agents/${agentId}`)
}

export function revokeAgentKey(agentId) {
  return post(`/api/v1/agents/revoke/${agentId}`)
}
```

#### `frontend/src/views/AgentDetail.vue` (MODIFY)

**Add imports** (after line 3):
```javascript
import { useAuthStore } from '@/stores/auth'
import { deleteAgent, revokeAgentKey } from '@/api/agents'
```

**Add authStore and computed properties** (after line 9):
```javascript
const authStore = useAuthStore()

const canRevoke = computed(() => authStore.user.value?.role === 'super_admin')
const canDelete = computed(() => {
  const role = authStore.user.value?.role
  return role === 'super_admin' || role === 'project_admin'
})
```

**Add confirmation state refs** (after line 9):
```javascript
const showRevokeConfirm = ref(false)
const showDeleteConfirm = ref(false)
const actionLoading = ref(false)
const actionError = ref(null)
```

**Add action functions** (after line 29):
```javascript
async function handleRevoke() {
  actionLoading.value = true
  actionError.value = null
  try {
    await revokeAgentKey(agent.value.agent_id || agent.value.id)
    showRevokeConfirm.value = false
    // Refresh detail to show updated key status
    const data = await fetchAgentDetail(route.params.id)
    agent.value = data
  } catch (err) {
    actionError.value = err.message || 'Failed to revoke API key'
  } finally {
    actionLoading.value = false
  }
}

async function handleDelete() {
  actionLoading.value = true
  actionError.value = null
  try {
    await deleteAgent(agent.value.agent_id || agent.value.id)
    router.push('/agents')
  } catch (err) {
    actionError.value = err.message || 'Failed to delete agent'
  } finally {
    actionLoading.value = false
  }
}
```

**Add to template** — insert before `<router-link to="/agents" class="back-link">` (before line 88):
```vue
<div v-if="canRevoke || canDelete" class="actions-section">
  <h2>Actions</h2>
  <div class="actions-buttons">
    <button v-if="canRevoke" class="btn-danger-outline" @click="showRevokeConfirm = true" :disabled="actionLoading">
      Revoke API Key
    </button>
    <button v-if="canDelete" class="btn-danger" @click="showDeleteConfirm = true" :disabled="actionLoading">
      Delete Agent
    </button>
  </div>
  <div v-if="actionError" class="error">{{ actionError }}</div>
</div>

<!-- Revoke Confirmation Modal -->
<div v-if="showRevokeConfirm" class="modal-overlay" @click.self="showRevokeConfirm = false">
  <div class="modal modal-sm">
    <h3>Revoke API Key</h3>
    <p>Are you sure you want to revoke the API key for <strong>{{ agent.agent_name || agent.name }}</strong>? The agent will no longer be able to make API calls.</p>
    <div class="modal-actions">
      <button class="btn-danger" @click="handleRevoke" :disabled="actionLoading">
        {{ actionLoading ? 'Revoking...' : 'Revoke' }}
      </button>
      <button class="btn-cancel" @click="showRevokeConfirm = false" :disabled="actionLoading">Cancel</button>
    </div>
  </div>
</div>

<!-- Delete Confirmation Modal -->
<div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
  <div class="modal modal-sm">
    <h3>Delete Agent</h3>
    <p>Are you sure you want to delete <strong>{{ agent.agent_name || agent.name }}</strong>? This action cannot be undone.</p>
    <div class="modal-actions">
      <button class="btn-danger" @click="handleDelete" :disabled="actionLoading">
        {{ actionLoading ? 'Deleting...' : 'Delete' }}
      </button>
      <button class="btn-cancel" @click="showDeleteConfirm = false" :disabled="actionLoading">Cancel</button>
    </div>
  </div>
</div>
```

**Add CSS** (before `</style>` closes):
```css
.actions-section {
  margin-bottom: 1.5rem;
}

.actions-section h2 {
  font-size: 18px;
  color: #1f2937;
  margin: 0 0 1rem 0;
}

.actions-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn-danger {
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger-outline {
  padding: 8px 16px;
  background: white;
  color: #ef4444;
  border: 1px solid #ef4444;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-danger-outline:hover:not(:disabled) {
  background: #fef2f2;
}

.btn-danger-outline:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 100%;
  max-width: 400px;
}

.modal-sm {
  max-width: 400px;
}

.modal h3 {
  margin: 0 0 12px;
  font-size: 18px;
  color: #1f2937;
}

.modal p {
  margin: 0 0 20px;
  color: #374151;
  font-size: 14px;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-cancel:hover:not(:disabled) {
  background: #f9fafb;
}

.btn-cancel:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
```

#### `frontend/src/views/AgentList.vue` (MODIFY)

**Add imports** (after line 4):
```javascript
import { listAgents } from '@/api/agents'
```

**Add refs** (after line 8):
```javascript
const activeTab = ref('heartbeat')
const agentsData = ref([])
const loadingAgents = ref(false)
```

**Add functions** (after line 43):
```javascript
async function loadAgents() {
  loadingAgents.value = true
  try {
    const data = await listAgents()
    agentsData.value = data || []
  } catch {
    agentsData.value = []
  } finally {
    loadingAgents.value = false
  }
}

function formatKeyPreview(key) {
  if (!key) return '—'
  return key.substring(0, 8) + '****'
}

function formatDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleDateString() : '—'
}
```

**Modify template header** — replace `<h1>Agents</h1>` (line 48):
```vue
<div class="header-row">
  <h1>Agents</h1>
  <button class="btn-primary" @click="showCreateModal = true">
    Create Agent
  </button>
</div>
<AgentModal v-model:show="showCreateModal" @created="handleCreate" />

<!-- Tabs -->
<div class="tabs">
  <button
    v-for="tab in tabs"
    :key="tab.id"
    :class="['tab', { active: activeTab === tab.id }]"
    @click="activeTab = tab.id"
  >
    {{ tab.label }}
  </button>
</div>
```

**Add tabs and agentsData refs** (after line 9):
```javascript
const tabs = [
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'agents', label: 'Agents' },
]
```

**Add CRUD agents table panel** — replace the existing `<div v-else class="empty-state">` block (lines 94-96) and add after the heartbeat table:
```vue
<!-- Agents Tab (CRUD) -->
<div v-if="activeTab === 'agents'">
  <div v-if="loadingAgents" class="loading">Loading agents...</div>
  <table v-else-if="agentsData.length > 0" class="agent-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>API Key</th>
        <th>Rate Limit</th>
        <th>Created</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
      <tr v-for="agent in agentsData" :key="agent.id">
        <td>{{ agent.name }}</td>
        <td><code>{{ formatKeyPreview(agent.api_key) }}</code></td>
        <td>{{ agent.rate_limit || 100 }}</td>
        <td>{{ formatDate(agent.created_at) }}</td>
        <td>
          <router-link :to="`/agents/${agent.id}`" class="link-details">
            View Details
          </router-link>
        </td>
      </tr>
    </tbody>
  </table>
  <div v-else class="empty-state">
    <p>No agents created yet.</p>
    <p class="empty-hint">Click "Create Agent" to get started.</p>
  </div>
</div>
```

**Add CSS** (after existing CSS, before `</style>` closes):
```css
.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.empty-hint {
  color: #9ca3af;
  font-size: 14px;
  margin-top: 4px;
}

.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary:hover {
  background: #2563eb;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
}

.tab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
}

.tab:hover {
  color: #374151;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.link-details {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}

.link-details:hover {
  text-decoration: underline;
}
```

---

### d) Dependencies

- [API client]: `del()` from `@/api/client` — DELETE HTTP method
- [API client]: `post()` from `@/api/client` — POST HTTP method
- [API client]: `listAgents()` from `@/api/agents` — GET agents list
- [Auth store]: `authStore.user.value?.role` — for permission checks
- [Existing component]: `AgentModal.vue` — confirmation modal pattern (from bp-69)

---

### e) Risks/Edge Cases

- **[Permission visibility]**: AgentDetail buttons shown based on role → Use computed properties for reactivity
- **[Race condition]**: User clicks delete while loading → Disable buttons during API call
- **[Agent ID format]**: Backend uses bigint `id`, frontend `agent_id` from heartbeat → Use `agent.value.agent_id || agent.value.id` fallback
- **[Network failure]**: Modal shows error, stays on page → Don't navigate on error
- **[Permission denied (403)**: Modal shows error message

---

### f) Testing

#### Frontend Unit Tests
- [ ] `frontend/src/__tests__/agents.test.js` — extend:
  - `deleteAgent()` calls DELETE /api/v1/agents/:id
  - `revokeAgentKey()` calls POST /api/v1/agents/revoke/:id
- [ ] Component tests: `frontend/cypress/component/AgentDetail.cy.ts` — CREATED
  - Renders action buttons (conditionally based on permissions)
  - Revoke button visible only for super_admin
  - Delete button visible for super_admin and project_admin
  - Confirm dialog shows on button click
  - Confirm calls API and handles response
  - Cancel closes dialog
- [ ] Component tests: `frontend/cypress/component/AgentList.cy.ts` — extend
  - Both tabs render correctly
  - CRUD table shows correct columns
  - "View Details" links navigate correctly
- [ ] Loading, error, and confirmation states tested

#### CI Requirements
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes

---

### g) Migration Notes
N/A — no database changes.

---

### h) Files Changed

**Frontend:**
```
frontend/src/api/agents.js              → MODIFY (add deleteAgent, revokeAgentKey)
frontend/src/views/AgentDetail.vue      → MODIFY (add action buttons, confirm modals)
frontend/src/views/AgentList.vue        → MODIFY (add tabs, CRUD agents table)
```

---

### i) Code Review Checklist

- [ ] AgentDetail.vue imports `useAuthStore`, `deleteAgent`, `revokeAgentKey`
- [ ] AgentDetail.vue uses computed properties for permission checks
- [ ] AgentDetail.vue action buttons disabled during API call
- [ ] AgentDetail.vue confirmation modals follow existing patterns
- [ ] AgentDetail.vue navigates to /agents after successful delete
- [ ] AgentDetail.vue refreshes detail after successful revoke
- [ ] AgentList.vue imports `listAgents` from `@/api/agents`
- [ ] AgentList.vue has tabs array with 'heartbeat' and 'agents'
- [ ] AgentList.vue CRUD table shows correct columns
- [ ] AgentList.vue "View Details" links use correct route
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] Linting passes
- [ ] Typecheck passes
- [ ] Build passes

---

### j) Post-Deploy Verification

1. [ ] Frontend: `npm run lint` passes
2. [ ] Frontend: `npm run typecheck` passes
3. [ ] Frontend: `npm run build` passes
4. [ ] Frontend: `npm test -- --run` passes
5. [ ] Visit `/agents/:id` as super_admin → see both Revoke and Delete buttons
6. [ ] Visit `/agents/:id` as project_admin → see only Delete button
7. [ ] Click Revoke → confirm → API key revoked, detail refreshes
8. [ ] Click Delete → confirm → agent deleted, navigate to /agents
9. [ ] Visit `/agents` → see both Heartbeat and Agents tabs
10. [ ] Click Agents tab → CRUD agents table shows

---

*Fill in all sections before starting implementation.*
