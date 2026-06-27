# bp-32: PhaseFlow.vue — Guided Phase UI — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Large
**Scope**: Frontend

## Purpose
Create the per-phase guided UI (`PhaseFlow.vue`) that replaces the flat kanban with dedicated screens for each of the 10 ticket phases.

## Implementation Order

1. **Create `frontend/src/api/phases.js`** — API client for phase data
   - Export `fetchPhases(ticketId)` — calls `GET /api/v1/tickets/:id/phases`
   - Export `transitionPhase(ticketId, targetPhase, metadata)` — calls `POST /api/v1/tickets/:id/phases/transition`
   - *Depends on*: nothing

2. **Modify `frontend/src/router/index.ts`** — add the `/flow` route
   - Add child route under `/projects/:id` with path `tickets/:ticketId/flow`
   - Name it `PhaseFlow`, lazy-load `PhaseFlow.vue`
   - *Depends on*: nothing (route points to file created in step 3)

3. **Create `frontend/src/views/PhaseFlow.vue`** — main container component
   - `<template>`: Loading state, error state, phase navigation bar (step indicator), `<component :is>` for phase content, compact toggle link
   - `<script setup>`: Import all phase sub-components, fetch phases on mount, handle phase transitions, reactive state for current phase
   - *Depends on*: Step 1 (API client), Steps 4-13 (sub-components can be stubs first, then filled)
   - Structure:
     ```vue
     <script setup>
     import { ref, computed, onMounted, shallowRef } from 'vue'
     import { useRoute, useRouter } from 'vue-router'
     import { fetchPhases, transitionPhase } from '@/api/phases'
     // Dynamic phase components
     import PhaseDraft from '@/views/phases/PhaseDraft.vue'
     // ... etc
     import PhaseDeployed from '@/views/phases/PhaseDeployed.vue'

     const route = useRoute()
     const router = useRouter()
     const projectId = computed(() => route.params.id)
     const ticketId = computed(() => route.params.ticketId)
     const loading = ref(true)
     const error = ref(null)
     const currentPhase = ref('draft')
     const phaseData = ref({})
     const availableTransitions = ref([])

     const phaseComponents = {
       draft: PhaseDraft, planning: PhasePlanning, plan_approved: PhasePlanApproved,
       assigned: PhaseAssigned, in_progress: PhaseInProgress, blocked: PhaseBlocked,
       review: PhaseReview, human_approval: PhaseHumanApproval,
       done: PhaseDone, deployed: PhaseDeployed,
     }

     onMounted(async () => {
       try {
         const data = await fetchPhases(ticketId.value)
         currentPhase.value = data.currentPhase
         phaseData.value = data
         availableTransitions.value = data.availableTransitions || []
       } catch (e) { error.value = e.message }
       finally { loading.value = false }
     })

     async function handleTransition(targetPhase, metadata) {
       try {
         await transitionPhase(ticketId.value, targetPhase, metadata)
         const data = await fetchPhases(ticketId.value)
         currentPhase.value = data.currentPhase
         phaseData.value = data
       } catch (e) { error.value = e.message }
     }
     </script>

     <template>
       <div class="phase-flow">
         <div class="phase-bar">...</div>
         <component :is="phaseComponents[currentPhase] || PhaseDraft"
           :phase-data="phaseData" :ticket-id="ticketId"
           :project-id="projectId"
           @transition="handleTransition" />
         <router-link :to="{ name: 'ProjectTickets', params: { id: projectId } }">
           Compact View
         </router-link>
       </div>
     </template>
     ```

4. **Create `PhaseDraft.vue`** — `frontend/src/views/phases/PhaseDraft.vue`
   - Form fields: title (text), description (textarea), priority (select: low/medium/high/critical)
   - Submit button calls `handleTransition('planning', { title, description, priority })`
   - Validation: title required, description min 10 chars

5. **Create `PhasePlanning.vue`** — `frontend/src/views/phases/PhasePlanning.vue`
   - Fetch available templates from `GET /api/v1/templates` or use hardcoded list
   - Radio group for template selection (Architect/Technical/Simple)
   - Planning doc fill area: markdown editor stub (simple textarea with preview toggle)
   - "Mark Ready" button → transition to `plan_approved`

6. **Create `PhasePlanApproved.vue`** — `frontend/src/views/phases/PhasePlanApproved.vue`
   - Read-only rendered plan content (fetched from planning docs API)
   - Two buttons: "Approve" (transition to `assigned`), "Reject" (transition to `planning` with reason textarea)
   - Show planning status badge

7. **Create `PhaseAssigned.vue`** — `frontend/src/views/phases/PhaseAssigned.vue`
   - Fetch agent list from `GET /api/v1/agents`
   - Render agent cards with name, status badge (online/idle/offline — color-coded)
   - "Auto-assign" checkbox → pick first available agent
   - Manual assign: click agent card, "Assign" button → transition to `in_progress`

8. **Create `PhaseInProgress.vue`** — `frontend/src/views/phases/PhaseInProgress.vue`
   - Tab layout: "Status Feed" tab + "Feedback" tab
   - Status feed: fetch and display agent action log as timeline
   - Feedback tab: message list + input box + send button (uses existing feedback API)
   - "Request Review" button → transition to `review`

9. **Create `PhaseBlocked.vue`** — `frontend/src/views/phases/PhaseBlocked.vue`
   - Show latest agent question (from feedback where `from_agent = true` and unresolved)
   - Reply form: textarea + submit → `POST /feedback`
   - "Mark Unblocked" button → transition to `in_progress`

10. **Create `PhaseReview.vue`** — `frontend/src/views/phases/PhaseReview.vue`
    - "Diff Viewer" placeholder: show gray box with "Diff viewer will appear here (bp-34)"
    - Comment list + add comment form (simple)
    - "Approve" → transition to `human_approval`
    - "Request Changes" → transition to `in_progress` with comment

11. **Create `PhaseHumanApproval.vue`** — `frontend/src/views/phases/PhaseHumanApproval.vue`
    - Summary section: ticket title, description, files changed count (stub), PR link
    - "Approve" → transition to `done`
    - "Reject" → transition to `in_progress` with reason

12. **Create `PhaseDone.vue`** — `frontend/src/views/phases/PhaseDone.vue`
    - "Deploy to [environment]" button (disabled with tooltip: "Requires bp-37 — Deployment Pipeline")
    - Ticket summary: title, status, completed at
    - "Back to Board" link

13. **Create `PhaseDeployed.vue`** — `frontend/src/views/phases/PhaseDeployed.vue`
    - Deployment info table: environment, timestamp, triggered by
    - "Rollback" button (disabled with tooltip: "Requires bp-37")
    - "Back to Board" link

14. **Modify `frontend/src/views/TicketDetail.vue`** — add "Open Guided Flow" button
    - Add `<router-link :to="{ name: 'PhaseFlow', params: { ...route.params, ticketId: ticket.id } }">` with button styling
    - Position near the existing action buttons

## Per-File Action Plan

### `frontend/src/api/phases.js` (CREATE)
```javascript
import { get, post } from './client'

export function fetchPhases(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/phases`)
}

export function transitionPhase(ticketId, targetPhase, metadata = {}) {
  return post(`/api/v1/tickets/${ticketId}/phases/transition`, { targetPhase, metadata })
}
```

### `frontend/src/router/index.ts` (MODIFY)
Add child route inside `/projects/:id` route's `children` array, after the `TicketDetail` route:
```typescript
{
  path: 'tickets/:ticketId/flow',
  name: 'PhaseFlow',
  component: () => import('../views/PhaseFlow.vue'),
  meta: { requiresAuth: true },
},
```

### `frontend/src/views/TicketDetail.vue` (MODIFY)
After the existing ticket detail actions section, add:
```vue
<router-link
  :to="{ name: 'PhaseFlow', params: { id: projectId, ticketId: ticket.id } }"
  class="btn btn-primary">
  Open Guided Flow
</router-link>
```

## Migration Plan
No migration needed. Existing routes remain unchanged. Old kanban board is still accessible.

## Test Plan

### Unit Tests (Vitest)
- [ ] `api/phases.js` — `fetchPhases` calls correct URL and returns data
- [ ] `api/phases.js` — `transitionPhase` posts correct body
- [ ] `PhaseDraft.vue` — form validation: empty title shows error
- [ ] `PhaseDraft.vue` — submit calls transition with correct params
- [ ] `PhaseFlow.vue` — renders loading state while fetching phases
- [ ] `PhaseFlow.vue` — renders error state on API failure
- [ ] `PhaseFlow.vue` — renders correct phase component for each phase
- [ ] Router — `/flow` route resolves to PhaseFlow component

### Manual Verification
- [ ] Navigate to `/projects/:id/tickets/:id/flow` — loads phase screen
- [ ] Draft phase: fill form, submit → transitions to planning
- [ ] Planning phase: select template → shows planning doc area
- [ ] Plan_approved phase: approve → transitions to assigned
- [ ] Assigned phase: select agent → transitions to in_progress
- [ ] In_progress phase: feedback tab posts and receives messages
- [ ] Blocked phase: reply form sends message, unblock transitions
- [ ] Review phase: approve transitions to human_approval
- [ ] Human_approval phase: approve transitions to done
- [ ] Done phase: shows deploy button
- [ ] "Compact view" toggle navigates to kanban board
- [ ] "Open Guided Flow" button appears in TicketDetail.vue

## Rollback Steps

1. Revert `router/index.ts` changes (remove flow route)
2. Delete `PhaseFlow.vue` and `views/phases/` directory
3. Revert `TicketDetail.vue` (remove button)
4. Delete `api/phases.js`
5. Run `npm test -- --run` to verify no regressions
