# bp-32: PhaseFlow.vue — Guided Phase UI — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Frontend

## Current State

`TicketBoard.vue` renders a 4-column kanban board with columns for backlog, in_progress, review, and done. `TicketDetail.vue` shows a ticket's full details in a modal/side panel. There is no per-phase dedicated UI — all phases look the same (a card on the board). The phase machine from bp-26 exists in the backend but has no frontend interface.

## Proposed Solution

### Approach

Create a new routed view `PhaseFlow.vue` that renders phase-specific screens based on the ticket's current phase. The component fetches the ticket's phase state from `GET /tickets/:id/phases` and renders the appropriate sub-component using Vue's `<component :is>` with dynamic imports.

The phase flow replaces the ticket detail view for users who want a guided, wizard-like experience. The old kanban board remains available via a "Compact view" toggle.

### Phase Screen Specifications

| Phase | Sub-Component | Key UI Elements | API Calls |
|-------|--------------|-----------------|-----------|
| draft | `PhaseDraft.vue` | Text inputs: title, description, priority dropdown, save button | `POST /tickets/:id/phases/transition` or auto-save on input |
| planning | `PhasePlanning.vue` | Template selector (radio list), planning doc fill area (markdown editor stub), "Mark Ready" button | `GET /templates`, `POST /phases/transition` |
| plan_approved | `PhasePlanApproved.vue` | Read-only rendered plan, Approve/Reject buttons with comment | `POST /phases/transition` with comment |
| assigned | `PhaseAssigned.vue` | Agent cards list (avatar, name, status badge, current load), auto-assign checkbox, "Assign" button | `GET /agents`, `POST /phases/transition` |
| in_progress | `PhaseInProgress.vue` | Status feed (timeline of agent actions), Feedback tab with message list + input, "Request Review" button | `GET /tickets/:id/feedback`, `POST /tickets/:id/feedback` |
| blocked | `PhaseBlocked.vue` | Agent's question display, reply textarea, submit, "Mark Unblocked" | Same feedback endpoints |
| review | `PhaseReview.vue` | Diff viewer placeholder, comment list + add comment, "Approve" / "Request Changes" buttons | `POST /phases/transition` |
| human_approval | `PhaseHumanApproval.vue` | Summary section (changes list, files changed, diff stats), "Approve" / "Reject" buttons | `POST /phases/transition` |
| done | `PhaseDone.vue` | Deploy button (placeholder, grayed out with tooltip if bp-37 not done), summary info | No API |
| deployed | `PhaseDeployed.vue` | Deployment info table (env, timestamp, triggered by), rollback button (placeholder) | No API |

### Data Flow

```
PhaseFlow.vue (onMounted)
  → fetch ticket phases: api/phases.fetchPhases(ticketId)
  → set currentPhase, availableTransitions, phaseData

User interacts with phase screen (e.g., clicks "Approve")
  → local validation
  → api/phases.transitionPhase(ticketId, targetPhase, metadata)
  → refresh phase data on success
  → error toast on failure

Compact view toggle
  → router.push({ name: 'ProjectTickets', params: { id: projectId } })
```

### Component Hierarchy

```
PhaseFlow.vue
├── PhaseHeader.vue (phase indicator bar, breadcrumbs, compact toggle)
├── PhaseDraft.vue (when currentPhase === 'draft')
├── PhasePlanning.vue (when currentPhase === 'planning')
├── PhasePlanApproved.vue
├── PhaseAssigned.vue
├── PhaseInProgress.vue
├── PhaseBlocked.vue
├── PhaseReview.vue
├── PhaseHumanApproval.vue
├── PhaseDone.vue
└── PhaseDeployed.vue
```

### Error Handling

| Error Scenario | Handling |
|---------------|----------|
| Phase fetch fails (network error) | Show error banner with retry button, set `loading=false` |
| Phase transition fails (validation error) | Display API error message inline, keep current phase |
| Component import fails (lazy load) | Show generic "Failed to load phase" error state |
| Invalid phase name from API | Fall back to generic read-only view |
| Concurrent transition (phase changed) | Refetch phase data, show toast "Phase was updated" |

### Alternatives Considered

- **Option B: All phase logic in one template with v-if** — Rejected because the file would exceed 1000+ lines. Child components keep each phase manageable.
- **Option C: Use Vue Router with nested routes per phase** — Rejected because phase transitions are within the same view, not separate pages.
- **Option D: Keep TicketBoard.vue as the sole view and add modals per phase** — Rejected because modals don't provide enough screen real estate for complex phases like review or planning.

## Security Considerations

- All phase transitions go through the existing backend auth/permission middleware
- Phase flow UI is read-only for roles without `TICKET_EDIT` permission (approve/reject buttons respect permissions)
- No sensitive data rendered in phase screens beyond what existing views show

## DB Changes

None. This is a frontend-only change.

## API Contract

### New API Client Calls

The new `frontend/src/api/phases.js` will export:

```javascript
// Fetches phase data for a ticket
// GET /api/v1/tickets/:id/phases
export function fetchPhases(ticketId)

// Transitions ticket to a new phase
// POST /api/v1/tickets/:id/phases/transition
// Body: { targetPhase: string, metadata?: object }
export function transitionPhase(ticketId, targetPhase, metadata)
```

### Router Changes

New route added to `frontend/src/router/index.ts`:

```typescript
{
  path: 'tickets/:ticketId/flow',
  name: 'PhaseFlow',
  component: () => import('../views/PhaseFlow.vue'),
  meta: { requiresAuth: true },
},
```

This is a child of the existing `/projects/:id` route.
