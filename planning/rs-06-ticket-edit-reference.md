# RS-6: Ticket Edit Modal — Reference Document

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Dependencies**: RS-3 (Auth middleware — role checks)

**References:**
- `01_ARCHITECT_REQUIREMENT.md` → Testing Guidelines, CI requirements, anti-patterns
- `02_ARCHITECT_DESIGN.md` → Role definitions, status transitions, role hierarchy
- `03_ARCHITECT_IMPLEMENTATION.md` → Implementation template structure

---

## Purpose

Add edit functionality to ticket detail view. Users can edit title, description, priority, and assignee via a modal. Status transitions remain as quick-action buttons. This ticket enables ticket modification for authorized roles while preserving the status transition flow.

---

## Role Context (from 02_ARCHITECT_DESIGN.md)

### Who Can Edit Tickets

| Role | Can Edit Any Ticket | Can Edit Own Tickets | Can Edit Assignee | Can Change Status |
|------|---------------------|---------------------|-------------------|-------------------|
| `super_admin` | Yes | Yes | Yes | Yes |
| `project_admin` | Yes | Yes | Yes | Yes |
| `member` | Yes | Yes | Yes | Yes |
| `user` | No | Yes | Yes | Yes (own only) |

### Status Transitions (from 02_ARCHITECT_DESIGN.md)

```
backlog → in_progress → review → done
  ↑            ↑            ↑
  └────┬───────┘            │
       └────────────────────┘
```

Valid transitions:
- `backlog` → `in_progress`
- `in_progress` → `review` or `backlog`
- `review` → `done` or `backlog`
- `done` → no outgoing transitions (terminal state)

---

## Files to Create/Modify

### Modified Files

#### `frontend/src/views/TicketDetail.vue`

**Current state:** Basic ticket detail view with title, description, status, priority, assignee display.

**Changes needed:**
1. Add "Edit" button (visible for project_admin, member, or ticket assignee)
2. Create edit modal with fields:
   - Title (text input)
   - Description (textarea)
   - Priority (dropdown: low, medium, high, critical)
   - Assignee (dropdown: users in same project)
3. Save button triggers `updateTicket(ticket.id, updates)`
4. Cancel button closes modal without saving
5. Loading state during save
6. Error toast on failure

**Updated layout:**
```
┌─────────────────────────────────────────────────────────┐
│  ← Back          Ticket Title                    [Edit] │
├─────────────────────────────────────────────────────────┤
│  Status: [backlog] [in_progress] [review] [done]        │
│  Priority: [high ▼]                                    │
│  Assignee: Alice                                       │
│                                                         │
│  Description:                                           │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Long description text...                            ││
│  └─────────────────────────────────────────────────────┘│
│                                                         │
│  Comments:                                              │
│  ┌─────────────────────────────────────────────────────┐│
│  │ Alice: This needs to be fixed                       ││
│  └─────────────────────────────────────────────────────┘│
│  [Add Comment]                                          │
└─────────────────────────────────────────────────────────┘
```

**Edit modal:**
```
┌──────────────────────────────────────┐
│  Edit Ticket                  [X]    │
├──────────────────────────────────────┤
│  Title:                              │
│  ┌──────────────────────────────────┐│
│  │ Enter ticket title               ││
│  └──────────────────────────────────┘│
│                                      │
│  Description:                        │
│  ┌──────────────────────────────────┐│
│  │                                  ││
│  │                                  ││
│  └──────────────────────────────────┘│
│                                      │
│  Priority:                           │
│  ┌──────────────────────────────────┐│
│  │ high ▼                           ││
│  └──────────────────────────────────┘│
│                                      │
│  Assignee:                           │
│  ┌──────────────────────────────────┐│
│  │ Alice ▼                          ││
│  └──────────────────────────────────┘│
│                                      │
│              [Save]    [Cancel]      │
└──────────────────────────────────────┘
```

**Component structure:**
```vue
<template>
  <div class="ticket-detail">
    <div class="header">
      <router-link :to="`/projects/${projectId}/tickets`">← Back</router-link>
      <h1>{{ ticket?.title }}</h1>
      <button v-if="canEdit" @click="openEditModal">Edit</button>
    </div>
    
    <div class="status-buttons">
      <button
        v-for="target in validTransitions"
        :key="target"
        @click="updateStatus(target)"
      >
        {{ target }}
      </button>
    </div>
    
    <div class="ticket-fields">
      <div class="field">
        <label>Priority</label>
        <select v-model="ticket.priority">{{ ticket.priority }}</select>
      </div>
      <div class="field">
        <label>Assignee</label>
        <span>{{ ticket.assignee?.name || 'Unassigned' }}</span>
      </div>
    </div>
    
    <div class="description">
      <h3>Description</h3>
      <p>{{ ticket.description }}</p>
    </div>
    
    <div class="comments">
      <h3>Comments</h3>
      <CommentList :comments="comments" />
      <CommentInput @add="addComment" />
    </div>
    
    <!-- Edit Modal -->
    <EditTicketModal
      v-if="showEditModal"
      :ticket="ticket"
      :users="projectUsers"
      @save="handleEdit"
      @cancel="showEditModal = false"
    />
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { getTicket, updateTicket, getUsers } from '@/api'

const route = useRoute()
const authStore = useAuthStore()

const ticket = ref(null)
const comments = ref([])
const projectUsers = ref([])
const showEditModal = ref(false)

const projectId = computed(() => route.params.id)

const canEdit = computed(() => {
  if (!ticket.value || !authStore.user.value) return false
  const user = authStore.user.value
  return (
    user.role === 'project_admin' ||
    user.role === 'member' ||
    user.role === 'super_admin' ||
    ticket.value.ownerId === user.userId ||
    ticket.value.assigneeId === user.userId
  )
})

const validTransitions = computed(() => {
  if (!ticket.value) return []
  const transitions = {
    backlog: ['in_progress'],
    in_progress: ['review', 'backlog'],
    review: ['done', 'backlog'],
    done: [],
  }
  return transitions[ticket.value.status] || []
})

onMounted(async () => {
  ticket.value = await getTicket(route.params.id)
  projectUsers.value = await getUsers()
})

async function handleEdit(updates) {
  try {
    await updateTicket(ticket.value.id, updates)
    ticket.value = { ...ticket.value, ...updates }
    showEditModal.value = false
  } catch (error) {
    // Show error toast
  }
}
</script>
```

#### `frontend/src/components/EditTicketModal.vue`

**New component:**
```vue
<template>
  <Teleport to="body">
    <div v-if="modelValue" class="modal-overlay" @click.self="cancel">
      <div class="modal">
        <h2>Edit Ticket</h2>
        <form @submit.prevent="handleSubmit">
          <div class="field">
            <label>Title *</label>
            <input
              v-model="form.title"
              type="text"
              placeholder="Enter ticket title"
              required
              :maxlength="200"
            />
            <span class="char-count">{{ form.title.length }}/200</span>
          </div>
          
          <div class="field">
            <label>Description</label>
            <textarea
              v-model="form.description"
              placeholder="Enter description"
              rows="4"
              :maxlength="5000"
            />
          </div>
          
          <div class="field">
            <label>Priority</label>
            <select v-model="form.priority">
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          
          <div class="field">
            <label>Assignee</label>
            <select v-model="form.assigneeId">
              <option :value="null">Unassigned</option>
              <option v-for="user in users" :key="user.id" :value="user.id">
                {{ user.name }} ({{ user.email }})
              </option>
            </select>
          </div>
          
          <div class="actions">
            <button type="submit" :disabled="saving">
              {{ saving ? 'Saving...' : 'Save' }}
            </button>
            <button type="button" @click="cancel">Cancel</button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, watch } from 'vue'

const props = defineProps({ modelValue: Boolean, ticket: Object, users: Array })
const emit = defineEmits(['update:modelValue', 'save', 'cancel'])

const saving = ref(false)
const form = ref({ title: '', description: '', priority: 'medium', assigneeId: null })

watch(
  () => props.ticket,
  (newTicket) => {
    if (newTicket) {
      form.value = {
        title: newTicket.title || '',
        description: newTicket.description || '',
        priority: newTicket.priority || 'medium',
        assigneeId: newTicket.assigneeId || null,
      }
    }
  },
  { immediate: true }
)

function cancel() {
  emit('cancel')
}

async function handleSubmit() {
  if (!form.value.title.trim()) return
  
  saving.value = true
  try {
    emit('save', {
      title: form.value.title.trim(),
      description: form.value.description.trim(),
      priority: form.value.priority,
      assigneeId: form.value.assigneeId,
    })
  } finally {
    saving.value = false
  }
}
</script>
```

### Modified Files

#### `backend/src/services/TicketService.js`

**Update `update()` to handle partial updates:**
```javascript
async update(id, data, userId) {
  const ticket = await Ticket.findById(id)
  if (!ticket) throw new Error('Ticket not found')

  // Check ownership/permissions
  const user = await User.findById(userId)
  if (
    user.role !== 'super_admin' &&
    user.role !== 'project_admin' &&
    ticket.ownerId !== userId &&
    ticket.assigneeId !== userId
  ) {
    throw new Error('Unauthorized to edit this ticket')
  }

  // Handle status transitions
  if (data.status && ticket.status !== data.status) {
    const validTransitions = {
      backlog: ['in_progress'],
      in_progress: ['review', 'backlog'],
      review: ['done', 'backlog'],
      done: [],
    }
    if (!validTransitions[ticket.status]?.includes(data.status)) {
      throw new Error('Invalid status transition')
    }
  }

  // Validate assignee is in same project (if changing assignee)
  if (data.assigneeId && data.assigneeId !== ticket.assigneeId) {
    const assignee = await User.findById(data.assigneeId)
    if (!assignee) throw new Error('Assignee not found')
    // Check if assignee is in same project
    const projectMember = await db.query(
      'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
      [ticket.projectId, data.assigneeId]
    )
    if (projectMember.rows.length === 0) {
      throw new Error('Assignee is not a member of this project')
    }
  }

  // Validate title not empty
  if (data.title !== undefined && !data.title.trim()) {
    throw new Error('Title cannot be empty')
  }

  return await Ticket.update(id, data)
}
```

#### `backend/src/api/tickets.js`

**Ensure update endpoint handles partial updates:**
```javascript
router.put('/:id', verifyToken, asyncHandler(async (req, res) => {
  const { id } = req.params
  const updates = req.body
  
  // Only allow specific fields to be updated
  const allowedFields = ['title', 'description', 'priority', 'status', 'assigneeId']
  const filteredUpdates = {}
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      filteredUpdates[field] = updates[field]
    }
  }

  const updated = await TicketService.update(id, filteredUpdates, req.user.id)
  res.json({ success: true, data: updated })
}))
```

---

## Testing (from 01_ARCHITECT_REQUIREMENT.md)

### Component Tests

**`cypress/component/EditTicketModal.cy.ts`:**
- [ ] Renders title, description, priority, assignee fields
- [ ] Title field is required (maxlength 200)
- [ ] Description field is optional (maxlength 5000)
- [ ] Priority dropdown has 4 options: low, medium, high, critical
- [ ] Assignee dropdown shows project users + "Unassigned"
- [ ] Pre-fills with existing ticket data
- [ ] Submit sends correct payload to API
- [ ] Cancel closes modal without saving
- [ ] Saving state shows disabled button with "Saving..." text

**`cypress/component/TicketDetail.cy.ts`:**
- [ ] Shows Edit button for project_admin
- [ ] Shows Edit button for member
- [ ] Shows Edit button for ticket owner
- [ ] Shows Edit button for ticket assignee
- [ ] Hides Edit button for user not owner/assignee
- [ ] Clicking Edit opens modal
- [ ] Status transition buttons work independently
- [ ] Edit modal and status buttons don't conflict

### E2E Tests

**`cypress/e2e/03-tickets.cy.ts`:**
- [ ] `project_admin` can edit any ticket's title
- [ ] `project_admin` can edit any ticket's description
- [ ] `project_admin` can change ticket priority
- [ ] `project_admin` can reassign tickets to other project members
- [ ] `member` can edit their own tickets
- [ ] `member` cannot edit other users' tickets → 403
- [ ] `user` can edit their own tickets
- [ ] `user` cannot edit other users' tickets → 403
- [ ] Empty title is rejected → error message shown
- [ ] Assignee not in project → error message shown
- [ ] Edit saves and updates UI immediately
- [ ] Cancel closes modal without saving changes
- [ ] Concurrent edits: last write wins (document this behavior)

### Unit Tests (Backend)

**`backend/src/__tests__/unit.test.js` — TicketService.update():**
- [ ] Valid status transition (backlog → in_progress) → succeeds
- [ ] Invalid status transition (backlog → done) → throws
- [ ] Partial update (title only) → updates only title
- [ ] Partial update (title + description) → updates both
- [ ] Assignee not in project → throws error
- [ ] Empty title → throws error
- [ ] Unauthorized user → throws error
- [ ] Ticket not found → throws error
- [ ] `TicketService.getOne()` checks project ownership → returns ticket

---

## Risks & Edge Cases

| Risk | Mitigation |
|------|-----------|
| **Concurrency** | Two users editing same ticket → last write wins (document this) |
| **Assignee validation** | Only users in same project can be assigned |
| **Priority changes** | No validation needed (always allowed) |
| **Empty title** | Prevent saving with empty title |
| **Form reset** | Reset form on modal close/cancel |
| **Status + edit conflict** | Status buttons and edit modal are separate flows |
| **authStore.user is a ref** | Must use `authStore.user.value` in script code (AGENTS.md bug #1) |
| **route.params.projectId undefined** | Should be `route.params.id` (AGENTS.md bug #2) |

---

## CI Requirements (from 01_ARCHITECT_REQUIREMENT.md)

- [ ] `npm run lint` — no unused vars, no errors
- [ ] `npm run typecheck` — passes
- [ ] `npm run build` — passes
- [ ] Component tests pass: `npx cypress run --component`
- [ ] E2E tests pass: `npx cypress run --e2e`

---

*This reference follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Testing checklist, CI requirements, anti-patterns*
- *`02_ARCHITECT_DESIGN.md` → Role definitions, status transitions, permissions matrix*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
