# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Ticket**: bp-69 — Add Create Agent button and modal to AgentList

**Status**: planned
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-07-07
**Date completed**: {{DATE}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Users cannot create agents because the AgentList page has no "Create Agent" button. The backend API and frontend API client already exist. This ticket adds the missing UI layer: a button and modal following the `UserModal.vue` pattern.

---

### b) Actions

**CRITICAL**: Backend API and frontend API client already exist. This is a frontend-only task.

#### Implementation Order

1. **Create AgentModal.vue** — `frontend/src/components/AgentModal.vue`
   - Props: `{ show: Boolean }`
   - Emits: `['update:show', 'created']`
   - Form: name input (required, 1-100 chars)
   - Submit: emits `created` with name
   - Loading: disable submit during API call
   - Error: inline error message
   - *Depends on*: nothing

2. **Modify AgentList.vue** — `frontend/src/views/AgentList.vue`
   - Import `createAgent` from `@/api/agents`
   - Add `showCreateModal` ref
   - Add "Create Agent" button
   - Add `<AgentModal>` component
   - Add `handleCreate` function
   - *Depends on*: Step 1

#### Phase 1: Frontend UI

1. **Create AgentModal.vue** — follow `UserModal.vue` pattern
   - Same modal overlay structure (`.modal-overlay`, `.modal`)
   - Same button structure (`.btn-submit`, `.btn-cancel`)
   - Same form structure (`v-model`, `@submit.prevent`)
   - Use `v-model:show` for two-way binding

2. **Modify AgentList.vue** — extend existing view
   - Add import: `import { createAgent } from '@/api/agents'`
   - Add import: `import AgentModal from '@/components/AgentModal.vue'`
   - Add ref: `const showCreateModal = ref(false)`
   - Add button in header area (after `<h1>Agents</h1>`)
   - Add component: `<AgentModal v-model:show="showCreateModal" @created="handleCreate" />`
   - Add handler:
     ```javascript
     async function handleCreate(name) {
       try {
         await createAgent(name)
         showCreateModal.value = false
       } catch (err) {
         // Error handled by modal
       }
     }
     ```

---

### c) Per-File Action Plan

#### `frontend/src/components/AgentModal.vue` (CREATE)

**Imports**:
```vue
<script setup>
import { ref } from 'vue'
```

**Props**:
```javascript
const props = defineProps({ show: Boolean })
const emit = defineEmits(['update:show', 'created'])
```

**State**:
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

**CSS classes** (scoped):
- `.modal-overlay` — fixed, inset: 0, z-index: 100, flex center
- `.modal` — white bg, rounded, padding: 24px, max-width: 400px
- `.form-group` — margin-bottom: 16px
- `.btn-submit` — blue bg, white text, rounded
- `.btn-cancel` — gray border, transparent bg
- `.error` — red text, 14px

#### `frontend/src/views/AgentList.vue` (MODIFY)

**Add imports** (after line 4):
```javascript
import { createAgent } from '@/api/agents'
import AgentModal from '@/components/AgentModal.vue'
```

**Add refs** (after line 8):
```javascript
const showCreateModal = ref(false)
const createError = ref(null)
```

**Add function** (after line 43):
```javascript
async function handleCreate(name) {
  try {
    await createAgent(name)
    showCreateModal.value = false
    createError.value = null
    // Optionally show success — could add a success message state
  } catch (err) {
    createError.value = err.message || 'Failed to create agent'
  }
}
```

**Add to template** — insert after `<h1>Agents</h1>` (line 48):
```vue
<div class="header-row">
  <h1>Agents</h1>
  <button class="btn-primary" @click="showCreateModal = true">
    Create Agent
  </button>
</div>
<AgentModal v-model:show="showCreateModal" @created="handleCreate" />
```

**Update empty state** (line 94-96):
```vue
<div v-else class="empty-state">
  <p>No agents found.</p>
  <p class="empty-hint">Click "Create Agent" to get started.</p>
</div>
```

**Add CSS** (after line 106):
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
}
.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}
.btn-primary:hover {
  background: #2563eb;
}
```

---

### d) Dependencies

- [API client]: `createAgent()` from `@/api/agents` — creates agent via POST
- [Existing UI pattern]: `UserModal.vue` — modal structure and CSS
- [Existing component]: `AgentList.vue` — extend with button and modal

---

### e) Risks/Edge Cases

- **[Modal z-index]**: Must be higher than page content → `z-index: 100` (follows UserModal)
- **[Escape key]**: User should close modal with Escape → Add keydown listener in AgentModal
- **[Rapid clicks]**: Submit button disabled during API call → Prevents duplicate requests
- **[Network failure]**: `.catch()` in submit → Modal shows error inline
- **[Empty name]**: Frontend validation + backend Joi validation → Double protection

---

### f) Testing

#### Frontend Unit Tests
- [ ] `frontend/src/__tests__/agents.test.js` — extend: `createAgent()` success returns agent, `createAgent()` failure returns rejected promise
- [ ] Component tests: `frontend/cypress/component/AgentModal.cy.ts` — CREATED
  - Renders name input
  - Submit emits `created` with name
  - Shows error on empty name
  - Closes on cancel
  - Submit disabled during loading
- [ ] Every new API client function has at least one test case
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

#### Frontend E2E Tests
- [ ] User flow: Visit /agents → Click "Create Agent" → Enter name → Submit → Verify modal closes

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
frontend/src/components/AgentModal.vue      → CREATE (modal component)
frontend/src/views/AgentList.vue            → MODIFY (add button, modal, handler)
```

---

### i) Code Review Checklist

- [ ] AgentModal.vue follows `<script setup>` syntax
- [ ] AgentModal.vue uses `v-model:show` for two-way binding
- [ ] AgentModal.vue follows UserModal.vue CSS patterns
- [ ] AgentList.vue imports `createAgent` from `@/api/agents`
- [ ] AgentList.vue imports `AgentModal` from `@/components/AgentModal.vue`
- [ ] AgentList.vue handles API error (try/catch in handleCreate)
- [ ] Submit button disabled during loading
- [ ] Input validated: 1-100 chars (matches backend Joi schema)
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
5. [ ] Visit `/agents` as super_admin or project_admin
6. [ ] Click "Create Agent" button → modal opens
7. [ ] Enter name → click Submit → agent created, modal closes
8. [ ] Empty state shows CTA text
9. [ ] Error handling works (try submitting empty name)

---

*Fill in all sections before starting implementation.*
