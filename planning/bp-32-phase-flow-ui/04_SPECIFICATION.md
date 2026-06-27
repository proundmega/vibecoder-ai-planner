# bp-32: PhaseFlow.vue — Spec

**Target model**: 14B–70B (Vue 3 + TypeScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `frontend/src/api/phases.js`

**Imports**:
```javascript
import { get, post } from './client'
```

**Exports**:
```javascript
export function fetchPhases(ticketId: string): Promise<PhasesResponse>
export function transitionPhase(ticketId: string, targetPhase: string, metadata?: Record<string, unknown>): Promise<void>
```

**Signature for `fetchPhases`**:
```javascript
export function fetchPhases(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/phases`)
}
```
Expects response format: `{ currentPhase: string, availableTransitions: string[], phases: Array<{name: string, data?: any}> }`

**Signature for `transitionPhase`**:
```javascript
export function transitionPhase(ticketId, targetPhase, metadata = {}) {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, { targetPhase, metadata })
}
```

### MODIFY: `frontend/src/router/index.ts`

**Change location**: Inside `children` array of `/projects/:id` route, after the `TicketDetail` child.

**Add import**: None — using lazy import inline.

**Add route**:
```typescript
{
  path: 'tickets/:ticketId/flow',
  name: 'PhaseFlow',
  component: () => import(/* webpackChunkName: "phase-flow" */ '../views/PhaseFlow.vue'),
  meta: { requiresAuth: true },
},
```

### CREATE: `frontend/src/views/PhaseFlow.vue`

**Imports**:
```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPhases, transitionPhase } from '@/api/phases'

// Lazy phase components
import PhaseDraft from '@/views/phases/PhaseDraft.vue'
import PhasePlanning from '@/views/phases/PhasePlanning.vue'
import PhasePlanApproved from '@/views/phases/PhasePlanApproved.vue'
import PhaseAssigned from '@/views/phases/PhaseAssigned.vue'
import PhaseInProgress from '@/views/phases/PhaseInProgress.vue'
import PhaseBlocked from '@/views/phases/PhaseBlocked.vue'
import PhaseReview from '@/views/phases/PhaseReview.vue'
import PhaseHumanApproval from '@/views/phases/PhaseHumanApproval.vue'
import PhaseDone from '@/views/phases/PhaseDone.vue'
import PhaseDeployed from '@/views/phases/PhaseDeployed.vue'
</script>
```

**Template structure**:
```vue
<template>
  <div class="phase-flow-container">
    <!-- Phase indicator bar -->
    <div class="phase-bar">
      <router-link :to="{ name: 'ProjectTickets', params: { id: projectId } }"
                   class="compact-toggle">Compact View</router-link>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="loading-spinner">Loading phases...</div>

    <!-- Error state -->
    <div v-else-if="error" class="error-banner">
      <p>{{ error }}</p>
      <button @click="loadPhases">Retry</button>
    </div>

    <!-- Phase content -->
    <component v-else
      :is="currentPhaseComponent"
      :phase-data="phaseData"
      :ticket-id="ticketId"
      :project-id="projectId"
      @transition="onTransition" />
  </div>
</template>
```

**Reactive state**:
```typescript
const loading = ref(true)
const error = ref<string | null>(null)
const currentPhase = ref('draft')
const phaseData = ref<any>({})
const availableTransitions = ref<string[]>([])

const phaseComponents: Record<string, Component> = {
  draft: PhaseDraft,
  planning: PhasePlanning,
  plan_approved: PhasePlanApproved,
  assigned: PhaseAssigned,
  in_progress: PhaseInProgress,
  blocked: PhaseBlocked,
  review: PhaseReview,
  human_approval: PhaseHumanApproval,
  done: PhaseDone,
  deployed: PhaseDeployed,
}

const currentPhaseComponent = computed(() => {
  return phaseComponents[currentPhase.value] || PhaseDraft
})
```

**Methods**:
```typescript
async function loadPhases() {
  loading.value = true
  error.value = null
  try {
    const data = await fetchPhases(ticketId.value)
    currentPhase.value = data.currentPhase
    availableTransitions.value = data.availableTransitions || []
    phaseData.value = data
  } catch (e: any) {
    error.value = e.message || 'Failed to load phase data'
  } finally {
    loading.value = false
  }
}

async function onTransition(targetPhase: string, metadata?: Record<string, unknown>) {
  try {
    await transitionPhase(ticketId.value, targetPhase, metadata)
    await loadPhases()
  } catch (e: any) {
    error.value = e.message || 'Transition failed'
  }
}

onMounted(loadPhases)
```

### CREATE: `frontend/src/views/phases/PhaseDraft.vue`

**Props**:
```typescript
defineProps<{
  phaseData: any
  ticketId: string
  projectId: string
}>()
const emit = defineEmits<{
  (e: 'transition', targetPhase: string, metadata?: Record<string, unknown>): void
}>()
```

**Local state**: `title`, `description`, `priority` refs.

**Validation**: `title.length > 0`, `description.length >= 10`.

**Submit**: `emit('transition', 'planning', { title, description, priority })`.

### CREATE: `frontend/src/views/phases/PhasePlanning.vue`

**Props/Emits**: Same pattern as PhaseDraft.

**Local state**: `selectedTemplate` ref, `planContent` ref.

**Template selector**: Radio buttons for Architect/Technical/Simple.

**Markdown editor**: Textarea with preview toggle (simple `v-html` with basic markdown conversion).

**Submit**: `emit('transition', 'plan_approved', { template: selectedTemplate, content: planContent })`.

### CREATE: `frontend/src/views/phases/PhasePlanApproved.vue`

**Props**: Same + `phaseData` includes `plan`.

**UI**: Read-only rendered plan in a `.plan-content` div with `white-space: pre-wrap`.

**Buttons**: "Approve" → `emit('transition', 'assigned')`, "Reject" → emit with `reason`.

### CREATE: `frontend/src/views/phases/PhaseAssigned.vue`

**Fetch agents**: Use `onMounted` to call `get('/api/v1/agents')`.

**Agent cards**: `div.agent-card` per agent with name, `span.status-badge` with color class (green=online, yellow=idle, red=offline).

**Local state**: `selectedAgentId`, `autoAssign` refs.

**Submit**: `emit('transition', 'in_progress', { agentId: selectedAgentId })`.

### CREATE: `frontend/src/views/phases/PhaseInProgress.vue`

**Tabs**: `activeTab = ref('feed')` with tabs: Status Feed (`feed`), Feedback (`feedback`).

**Status feed**: Array of action objects rendered as a timeline with CSS `::before` dots.

**Feedback tab**: Import `post` from `@/api/client`, send messages, display list. Uses existing feedback API pattern.

**Button**: "Request Review" → `emit('transition', 'review')`.

### CREATE: `frontend/src/views/phases/PhaseBlocked.vue`

**Display**: Shows latest unresponded agent feedback message.

**Reply form**: Textarea + "Send Reply" button → `POST /api/v1/tickets/:ticketId/feedback`.

**Unblock**: Button → `emit('transition', 'in_progress')`.

### CREATE: `frontend/src/views/phases/PhaseReview.vue`

**Diff viewer**: Placeholder `div.diff-placeholder` with gray background and text.

**Comments**: Simple list + input, stored locally (no backend persistence without approval action).

**Buttons**: "Approve" → `emit('transition', 'human_approval')`, "Request Changes" → emit with comment.

### CREATE: `frontend/src/views/phases/PhaseHumanApproval.vue`

**Summary section**: Ticket title, description, files changed count (hardcoded `0` until bp-34/35), any comments.

**Buttons**: "Approve" → `emit('transition', 'done')`, "Reject" → emit with reason → `in_progress`.

### CREATE: `frontend/src/views/phases/PhaseDone.vue`

**Deploy button**: `<button disabled class="btn btn-secondary" title="Requires bp-37 — Deployment Pipeline">Deploy to Staging</button>`.

**Summary**: Ticket title, status badge (`done`), completed timestamp.

### CREATE: `frontend/src/views/phases/PhaseDeployed.vue`

**Deployment info table**: Environment (stub), Timestamp, Triggered By.

**Rollback button**: Disabled with tooltip.

### MODIFY: `frontend/src/views/TicketDetail.vue`

**Change location**: After the ticket detail header section, before or after existing action buttons.

**Add**:
```vue
<router-link
  :to="{ name: 'PhaseFlow', params: { id: projectId, ticketId: ticket.id } }"
  class="btn btn-primary ml-2">
  <span class="btn-icon">→</span> Open Guided Flow
</router-link>
```

## Test Expectations

### Unit Tests
- [ ] `phases.js` — `fetchPhases` calls `GET /api/v1/tickets/:id/phases`
- [ ] `phases.js` — `transitionPhase` calls `POST /api/v1/tickets/:id/phases/transition` with correct body
- [ ] `PhaseDraft.vue` — renders form with title, description, priority fields
- [ ] `PhaseDraft.vue` — emits transition with form values on submit
- [ ] `PhaseDraft.vue` — shows validation error when title is empty
- [ ] `PhaseFlow.vue` — shows loading spinner initially
- [ ] `PhaseFlow.vue` — shows error banner when fetchPhases fails
- [ ] `PhaseFlow.vue` — renders correct phase sub-component based on currentPhase
- [ ] Router flow route — resolves to PhaseFlow.vue component

### Manual Verification
- [ ] Full phase flow from draft → planning → plan_approved → assigned → in_progress → review → human_approval → done
- [ ] Blocked phase: reply then unblock
- [ ] Compact view toggle works from any phase
- [ ] Open Guided Flow button appears in TicketDetail
- [ ] Error banner on network failure with retry

## Edge Cases to Handle

1. **API returns unknown phase name** — `phaseComponents[currentPhase]` returns undefined → fallback to PhaseDraft
2. **Phase fetch returns 404** — ticket doesn't exist → error banner "Ticket not found"
3. **Phase transition conflicts** — another user changed phase → refetch shows new phase, user sees toast
4. **Empty agent list** — assigned phase shows "No agents available" message
5. **Draft form with only whitespace** — trim inputs before validation
6. **Rapid double-click on transition buttons** — disable button after first click, re-enable on success/error
7. **Phase data shape varies by phase** — use TypeScript interfaces per phase in a `types.ts` file, or defensive `?.` access

## Existing Code Patterns to Follow

- `<script setup lang="ts">` with Composition API
- `@/` alias for imports (e.g., `@/api/client`, `@/views/...`)
- `useRoute()` and `useRouter()` from `vue-router`
- `scoped` CSS with class names in `kebab-case`
- Error handling: `try/catch` with `console.error` and user-facing error message
- Loading state: `ref(true)` initially, set to `false` in `finally`
- API client: use `get`, `post` from `@/api/client`, `.catch()` on caller side
- `onMounted` for data fetching
- Use `v-if`/`v-else` for conditional rendering (not `v-show`)
- Bootstrap-like utility classes (`btn`, `btn-primary`, `ml-2`, etc.) consistent with existing views

## Files NOT to Change

- `TicketBoard.vue` — remains as compact kanban view
- `backend/src/*` — no backend changes in this ticket
- `frontend/src/stores/*` — no Pinia store changes
- `frontend/src/api/client.js` — no changes to base client
- `frontend/src/App.vue` — no layout changes
