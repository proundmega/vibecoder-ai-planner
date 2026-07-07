# 04_SPECIFICATION.md — Model Execution Spec

**Generated from**: `01_ARCHITECT_REQUIREMENT.md`, `02_ARCHITECT_DESIGN.md`, `03_ARCHITECT_IMPLEMENTATION.md`
**Target model**: 34B local model (or Claude/GPT)
**Date**: 2026-07-07

---

## File Operations

### CREATE: `frontend/src/components/AgentModal.vue`

**Imports**:
```vue
<script setup>
import { ref } from 'vue'
```

**Props and emits**:
```javascript
const props = defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'created'])
```

**State variables**:
```javascript
const name = ref('')
const error = ref('')
const loading = ref(false)
```

**Functions**:
```javascript
function close() {
  emit('update:show', false)
  name.value = ''
  error.value = ''
}

async function submit() {
  if (!name.value.trim()) {
    error.value = 'Name is required'
    return
  }
  if (name.value.trim().length > 100) {
    error.value = 'Name must be 100 characters or less'
    return
  }
  loading.value = true
  error.value = ''
  try {
    emit('created', name.value.trim())
    close()
  } catch (err) {
    error.value = err.message || 'Failed to create agent'
  } finally {
    loading.value = false
  }
}
```

**Template structure**:
```vue
<Teleport to="body">
  <div v-if="show" class="modal-overlay" @click.self="close">
    <div class="modal">
      <h2>Create Agent</h2>
      <form @submit.prevent="submit">
        <div class="form-group">
          <label for="agent-name">Agent Name</label>
          <input id="agent-name" v-model="name" type="text"
                 placeholder="e.g., Code Reviewer"
                 :disabled="loading" autofocus />
        </div>
        <div v-if="error" class="error">{{ error }}</div>
        <div class="modal-actions">
          <button type="submit" class="btn-submit"
                  :disabled="loading || !name.trim()">
            {{ loading ? 'Creating...' : 'Create' }}
          </button>
          <button type="button" class="btn-cancel"
                  @click="close" :disabled="loading">Cancel</button>
        </div>
      </form>
    </div>
  </div>
</Teleport>
```

**Styling** (scoped CSS):
```css
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
.modal h2 {
  margin: 0 0 16px;
  font-size: 18px;
  color: #1f2937;
}
.form-group {
  margin-bottom: 16px;
}
.form-group label {
  display: block;
  margin-bottom: 4px;
  font-weight: 500;
  color: #374151;
  font-size: 14px;
}
.form-group input {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  box-sizing: border-box;
}
.form-group input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
.error {
  color: #ef4444;
  margin-bottom: 12px;
  font-size: 14px;
}
.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}
.btn-submit {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}
.btn-submit:hover:not(:disabled) {
  background: #2563eb;
}
.btn-submit:disabled {
  opacity: 0.6;
  cursor: not-allowed;
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

### MODIFY: `frontend/src/views/AgentList.vue`

**Add imports** (after line 4, after `import { fetchAgentStatusList } from '@/api/agents'`):
```javascript
import { createAgent } from '@/api/agents'
import AgentModal from '@/components/AgentModal.vue'
```

**Add refs** (after line 8, after `const error = ref(null)`):
```javascript
const showCreateModal = ref(false)
const createError = ref(null)
```

**Add function** (after line 43, after `formatCost`):
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
```

**Modify template** — replace line 48 `<h1>Agents</h1>` with:
```vue
<div class="header-row">
  <h1>Agents</h1>
  <button class="btn-primary" @click="showCreateModal = true">
    Create Agent
  </button>
</div>
<AgentModal v-model:show="showCreateModal" @created="handleCreate" />
```

**Modify empty state** — replace lines 94-96:
```vue
<div v-else class="empty-state">
  <p>No agents found.</p>
  <p class="empty-hint">Click "Create Agent" to get started.</p>
</div>
```

**Add CSS** (after line 106, before `<style scoped>` closes):
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
```

---

## Test Expectations

### Frontend Unit Tests — agents.js
```
✓ [happy] createAgent('My Agent') calls POST /api/v1/agents/create with correct body
✓ [error] createAgent() fails when backend returns 400
```

### Frontend Component Tests — AgentModal
```
✓ [ui] AgentModal renders name input when show is true
✓ [ui] AgentModal is not rendered when show is false
✓ [ui] Submitting with name emits 'created' with trimmed name
✓ [ui] Submitting with empty name shows error message
✓ [ui] Submitting with name > 100 chars shows error message
✓ [ui] Clicking Cancel emits 'update:show' with false
✓ [ui] Submit button is disabled when loading is true
✓ [ui] Submit button is disabled when name is empty
✓ [ui] Clicking overlay closes modal (click.self)
```

---

## Edge Cases to Handle

1. **Empty name**: Frontend validation shows "Name is required" error
2. **Name > 100 chars**: Frontend validation shows "Name must be 100 characters or less" error
3. **Name with whitespace**: `.trim()` applied before emit, so "  My Agent  " becomes "My Agent"
4. **API call fails**: Modal shows error message inline, does NOT close
5. **Rapid clicks**: Submit button disabled during `loading`, prevents duplicate requests
6. **Escape key**: User can close modal by clicking overlay (`.click.self` on overlay)

---

## Existing Code Patterns to Follow

- Use `<script setup>` syntax, not Options API (AgentList.vue already uses it)
- Import from `@/api/agents` and `@/components/` (not relative paths)
- Error messages in English, no i18n wrappers
- Modal uses `Teleport to="body"` (follows Vue best practices)
- CSS classes follow Tailwind-adjacent naming (`.btn-submit`, `.btn-cancel`, `.modal-overlay`)
- State uses `ref()` not `reactive()` (follows AgentList.vue pattern)

---

## Files NOT to Change

- `backend/src/api/agents.js` — already works correctly
- `backend/src/services/AgentService.js` — already works correctly
- `frontend/src/api/agents.js` — `createAgent()` already exists
- `frontend/src/router/index.ts` — `/agents` route already exists
- `frontend/src/components/UserModal.vue` — existing pattern, don't modify
- `frontend/src/components/TicketEditModal.vue` — existing pattern, don't modify

---

*This specification is the contract between planning and execution.*
