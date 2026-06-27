# bp-39: Milestones & Timeline — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Both

## Current State

- Tickets table has: id, project_id, title, description, status, priority, phase, assigned_to, created_at, updated_at
- No milestone grouping. No estimates. No dependency tracking.
- TicketService.update() transitions through phases with status validation
- Frontend TicketBoard.vue shows a kanban with all tickets unfiltered

## Proposed Solution

### Database Schema

**Migration 025 — milestones table**:
```sql
CREATE TABLE milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(128) NOT NULL,
  description TEXT,
  target_date DATE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_milestones_one_active
  ON milestones(project_id) WHERE is_active = true;
```

**Migration 026 — ticket fields**:
```sql
ALTER TABLE tickets ADD COLUMN milestone_id UUID REFERENCES milestones(id);
ALTER TABLE tickets ADD COLUMN estimate INTEGER;
ALTER TABLE tickets ADD COLUMN depends_on UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX idx_tickets_milestone ON tickets(milestone_id);
```

### MilestoneService API

| Method | Signature | Description |
|--------|-----------|-------------|
| `list(projectId)` | `async list(projectId) → Milestone[]` | All milestones for project |
| `create(projectId, data)` | `async create(projectId, { name, description, targetDate }) → Milestone` | Create, deactivate previous active |
| `update(id, data)` | `async update(id, { name, description, targetDate }) → Milestone` | Update non-active fields |
| `getProgress(id)` | `async getProgress(id) → { totalEstimate, completedEstimate, percentage }` | Aggregate progress |
| `getTickets(id)` | `async getTickets(id) → Ticket[]` | Tickets in milestone with current phase |

### Dependency Enforcement in TicketService

```javascript
// In TicketService.update() or specific transition method:
async function transitionToInProgress(ticketId, userId) {
  const ticket = await Ticket.findById(ticketId);
  if (ticket.depends_on && ticket.depends_on.length > 0) {
    const deps = await Ticket.findByIds(ticket.depends_on);
    const incomplete = deps.filter(d => d.status !== 'done' && d.phase !== 'done');
    if (incomplete.length > 0) {
      throw new ValidationError(
        `Cannot start: dependencies not done: ${incomplete.map(d => d.title).join(', ')}`
      );
    }
  }
  // ... proceed with transition
}
```

### Cycle Detection

```javascript
function hasCycle(ticketId, dependsOn, visited = new Set(), recursionStack = new Set()) {
  if (recursionStack.has(ticketId)) return true;
  if (visited.has(ticketId)) return false;
  visited.add(ticketId);
  recursionStack.add(ticketId);
  for (const depId of dependsOn) {
    if (hasCycle(depId, depMap.get(depId) || [], visited, recursionStack)) return true;
  }
  recursionStack.delete(ticketId);
  return false;
}
```

### Frontend Component Architecture

```
ProjectDetail.vue
├── ProjectTabs (existing)
│   ├── Tickets tab (existing TicketBoard.vue)
│   ├── AI tab (existing)
│   ├── GitHub tab (existing)
│   ├── Templates tab (existing)
│   └── Milestones tab (NEW)
│       ├── MilestoneList.vue — shows all milestones, highlight active
│       ├── MilestoneProgress.vue — progress bar per milestone
│       ├── NewMilestoneModal.vue — create form
│       └── SprintBoard.vue — (optional) filtered board for active milestone
├── TicketDetail.vue (existing)
│   └── Milestone picker (NEW dropdown)
│   └── Dependency picker (NEW multi-select)
```

### Data Flow for Ticket Dependency

```
User edits ticket → selects depends_on tickets → PATCH /tickets/:id { depends_on }
  → Backend validates: no self-reference, no cycles
  → Backend updates tickets.depends_on
  → When user attempts to move to in_progress:
  → TicketService checks all deps are done
  → If not done → error message listing blocking tickets
```

### Alternatives Considered

- **Option B: Separate sprint table** — More complex, adds sprint dates, backlog grooming. Not needed yet.
- **Option C: Soft deletes for milestones** — We use deactivation instead (is_active toggle) since milestones are immutable historical records.

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/025_milestones.sql` | CREATE | milestones table with partial unique index |
| `backend/src/migrations/026_ticket_milestone_fields.sql` | CREATE | Add milestone_id, estimate, depends_on |
| `backend/src/services/MilestoneService.js` | CREATE | CRUD + progress + tickets listing |
| `backend/src/api/milestones.js` | CREATE | REST routes |
| `backend/src/api/v1/index.js` | MODIFY | Mount milestones router |
| `backend/src/services/TicketService.js` | MODIFY | Add dependency check in transition method |
| `backend/src/api/tickets.js` | MODIFY | Accept depends_on, estimate, milestone_id in update |
| `backend/validators/tickets.js` | MODIFY | Accept new fields |
| `frontend/src/api/milestones.js` | CREATE | API client |
| `frontend/src/views/ProjectDetail.vue` | MODIFY | Add Milestones tab |
| `frontend/src/components/NewMilestoneModal.vue` | CREATE | Create milestone form |
| `frontend/src/components/MilestoneProgress.vue` | CREATE | Progress bar |
| `frontend/src/components/TicketDependencyPicker.vue` | CREATE | Multi-select for depends_on |
| `frontend/src/components/TicketEditForm.vue` | MODIFY | Add milestone + dependency fields |
