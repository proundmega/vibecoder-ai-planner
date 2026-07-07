# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model (or Claude/GPT)
**Date**: 2026-07-07

---

## File Operations

### MODIFY: `frontend/src/api/agents.js`

**Add after line 25** (after `fetchAgentDetail` function):
```javascript
export function deleteAgent(agentId) {
  return del(`/api/v1/agents/${agentId}`)
}

export function revokeAgentKey(agentId) {
  return post(`/api/v1/agents/revoke/${agentId}`)
}
```

**No other changes to this file.**

---

### MODIFY: `frontend/src/views/AgentDetail.vue`

**Add imports** (after line 3, after `import { fetchAgentDetail } from '@/api/agents'`):
```javascript
import { useAuthStore } from '@/stores/auth'
import { deleteAgent, revokeAgentKey } from '@/api/agents'
```

**Add `computed` import** (modify line 1):
```javascript
// Change from:
import { ref, onMounted } from 'vue'
// To:
import { ref, onMounted, computed } from 'vue'
```

**Add router import** (modify line 1):
```javascript
// Change from:
import { useRoute } from 'vue-router'
// To:
import { useRoute, useRouter } from 'vue-router'
```

**Add authStore and computed** (after line 9, after `const error = ref(null)`):
```javascript
const authStore = useAuthStore()
const router = useRouter()
const showRevokeConfirm = ref(false)
const showDeleteConfirm = ref(false)
const actionLoading = ref(false)
const actionError = ref(null)

const canRevoke = computed(() => authStore.user.value?.role === 'super_admin')
const canDelete = computed(() => {
  const role = authStore.user.value?.role
  return role === 'super_admin' || role === 'project_admin'
})
```

**Add action functions** (after line 29, after `formatDate` function):
```javascript
async function handleRevoke() {
  actionLoading.value = true
  actionError.value = null
  try {
    const agentId = agent.value.agent_id || agent.value.id
    await revokeAgentKey(agentId)
    showRevokeConfirm.value = false
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
    const agentId = agent.value.agent_id || agent.value.id
    await deleteAgent(agentId)
    router.push('/agents')
  } catch (err) {
    actionError.value = err.message || 'Failed to delete agent'
  } finally {
    actionLoading.value = false
  }
}
```

**Modify template** — insert before `<router-link to="/agents" class="back-link">` (before line 88):
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

**Add CSS** (before `</style>` closes at end of file):
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

---

### MODIFY: `frontend/src/views/AgentList.vue`

**Add imports** (after line 4, after `import { fetchAgentStatusList } from '@/api/agents'`):
```javascript
import { listAgents } from '@/api/agents'
import AgentModal from '@/components/AgentModal.vue'
```

**Add refs** (after line 8, after `const error = ref(null)`):
```javascript
const showCreateModal = ref(false)
const createError = ref(null)
const activeTab = ref('heartbeat')
const agentsData = ref([])
const loadingAgents = ref(false)
```

**Add tabs array** (after refs, before `loadAgents` function):
```javascript
const tabs = [
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'agents', label: 'Agents' },
]
```

**Add functions** (after `formatCost` function, before `</script>`):
```javascript
async function handleCreate(name) {
  try {
    await createAgent(name)
    showCreateModal.value = false
    createError.value = null
  } catch (err) {
    createError.value = err.message || 'Failed to create agent'
  }
}

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

**Modify template** — replace `<h1>Agents</h1>` (line 48) with:
```vue
<div class="header-row">
  <h1>Agents</h1>
  <button class="btn-primary" @click="showCreateModal = true">
    Create Agent
  </button>
</div>
<AgentModal v-model:show="showCreateModal" @created="handleCreate" />

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

**Replace empty state block** (lines 93-97) with:
```vue
      </table>
      <div v-else class="empty-state">
        <p>No heartbeat data found.</p>
        <p class="empty-hint">Agents may not have sent heartbeats recently.</p>
      </div>
    </div>

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

**Add CSS** (before `</style>` closes at end of file):
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

## Test Expectations

### Frontend Unit Tests — agents.js
```
✓ [api] deleteAgent('123') calls DELETE /api/v1/agents/123
✓ [api] revokeAgentKey('123') calls POST /api/v1/agents/revoke/123
```

### Frontend Component Tests — AgentDetail
```
✓ [ui] AgentDetail renders Revoke button only when user is super_admin
✓ [ui] AgentDetail renders Delete button when user is super_admin or project_admin
✓ [ui] AgentDetail does NOT render Delete button for user or member role
✓ [ui] Clicking Revoke opens confirmation modal
✓ [ui] Clicking Delete opens confirmation modal
✓ [ui] Confirming Revoke calls revokeAgentKey API
✓ [ui] Confirming Delete calls deleteAgent API and navigates to /agents
✓ [ui] Canceling confirmation closes modal
✓ [ui] Buttons disabled during actionLoading
✓ [ui] Error message shown when API call fails
```

### Frontend Component Tests — AgentList
```
✓ [ui] AgentList shows both Heartbeat and Agents tabs
✓ [ui] Heartbeat tab shows existing heartbeat table
✓ [ui] Agents tab shows CRUD agents table when agents exist
✓ [ui] Agents tab shows "No agents created yet" when empty
✓ [ui] CRUD table shows Name, API Key, Rate Limit, Created, Actions columns
✓ [ui] API key displayed as preview (first 8 chars + ****)
✓ [ui] "View Details" links navigate to /agents/:id
✓ [ui] Loading state shows spinner while fetching agents
```

---

## Edge Cases to Handle

1. **Agent ID fallback**: `agent.value.agent_id || agent.value.id` — heartbeat uses `agent_id`, CRUD uses `id`
2. **Permission mismatch**: Backend returns 403 if user lacks permission → Modal shows error (buttons already hidden by computed)
3. **Delete while loading**: Buttons disabled during `actionLoading` → Prevents duplicate requests
4. **Network failure during delete**: Modal shows error, stays on detail page → Don't navigate on error
5. **Empty API key in CRUD table**: `formatKeyPreview(null)` returns '—'
6. **Tab switch without loading**: Clicking "Agents" tab triggers `loadAgents()` → Should add click handler or use `onMounted` to pre-load

---

## Existing Code Patterns to Follow

- Use `<script setup>` syntax, not Options API
- Import from `@/stores/auth`, `@/api/agents`, `@/api/client` (not relative paths)
- Error messages in English, no i18n wrappers
- Modal uses `v-if` with `modal-overlay` class and `@click.self` for backdrop close
- CSS classes follow existing naming (`.btn-danger`, `.btn-cancel`, `.modal-overlay`)
- State uses `ref()` not `reactive()`
- Permission checks use `authStore.user.value?.role` (Vue ref, not plain value)
- Use `computed()` for permission-derived values

---

## Files NOT to Change

- `backend/src/api/agents.js` — already works correctly
- `backend/src/services/AgentService.js` — already works correctly
- `frontend/src/router/index.ts` — routes already exist
- `frontend/src/components/UserModal.vue` — existing pattern, don't modify
- `frontend/src/api/client.ts` — `del()` and `post()` already exist

---

*This specification is the contract between planning and execution.*
