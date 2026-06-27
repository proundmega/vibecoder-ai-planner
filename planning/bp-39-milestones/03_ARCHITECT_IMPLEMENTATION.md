# bp-39: Milestones & Timeline — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

## Purpose
Add milestone grouping, estimates, and ticket dependencies to enable sprint-level project management.

## Implementation Order

1. **Migration 025** — Create milestones table
2. **Migration 026** — Add milestone_id, estimate, depends_on to tickets
3. **MilestoneService.js** — CRUD + progress calculation
4. **API milestones.js** — REST routes for milestones
5. **Modify v1/index.js** — Mount milestones router
6. **Modify TicketService.js** — Add dependency enforcement
7. **Modify tickets.js API** — Accept new fields
8. **Frontend milestones API** — Frontend client methods
9. **Frontend components** — MilestoneProgress, NewMilestoneModal, DependencyPicker
10. **Modify ProjectDetail.vue** — Add milestones tab
11. **Modify TicketEditForm** — Milestone + dependency pickers

## Per-File Action Plan

### `backend/src/migrations/025_milestones.sql` (CREATE)
```sql
-- Migration: 025_milestones.sql
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

### `backend/src/migrations/026_ticket_milestone_fields.sql` (CREATE)
```sql
-- Migration: 026_ticket_milestone_fields.sql
ALTER TABLE tickets ADD COLUMN milestone_id UUID REFERENCES milestones(id);
ALTER TABLE tickets ADD COLUMN estimate INTEGER;
ALTER TABLE tickets ADD COLUMN depends_on UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX idx_tickets_milestone ON tickets(milestone_id);
```

### `backend/src/services/MilestoneService.js` (CREATE)
- `list(projectId)` — SELECT * FROM milestones WHERE project_id = $1 ORDER BY created_at DESC
- `create(projectId, { name, description, targetDate })` — BEGIN; UPDATE milestones SET is_active=false WHERE project_id=$1 AND is_active=true; INSERT milestone; COMMIT;
- `update(id, { name, description, targetDate })` — UPDATE milestones SET ... WHERE id=$1
- `getProgress(id)` — SELECT COALESCE(SUM(estimate), 0) as total, COALESCE(SUM(estimate) FILTER (WHERE phase='done'), 0) as completed FROM tickets WHERE milestone_id=$1; return { totalEstimate, completedEstimate, percentage }
- `getTickets(id)` — SELECT * FROM tickets WHERE milestone_id=$1 ORDER BY created_at
- Internal `_deactivatePrevious(projectId)` — UPDATE milestones SET is_active=false WHERE project_id=$1 AND is_active=true

### `backend/src/api/milestones.js` (CREATE)
```javascript
const express = require('express');
const router = express.Router({ mergeParams: true });
const { verifyToken } = require('../middleware/auth');
const MilestoneService = require('../services/MilestoneService');

router.get('/', verifyToken, async (req, res, next) => {
  const milestones = await MilestoneService.list(req.params.projectId);
  res.json({ success: true, data: milestones });
});

router.post('/', verifyToken, async (req, res, next) => {
  const { name, description, targetDate } = req.body;
  const milestone = await MilestoneService.create(req.params.projectId, { name, description, targetDate });
  res.status(201).json({ success: true, data: milestone });
});

router.put('/:id', verifyToken, async (req, res, next) => {
  const milestone = await MilestoneService.update(req.params.id, req.body);
  res.json({ success: true, data: milestone });
});

router.get('/:id/progress', verifyToken, async (req, res, next) => {
  const progress = await MilestoneService.getProgress(req.params.id);
  res.json({ success: true, data: progress });
});

router.get('/:id/tickets', verifyToken, async (req, res, next) => {
  const tickets = await MilestoneService.getTickets(req.params.id);
  res.json({ success: true, data: tickets });
});

module.exports = router;
```

### `backend/src/api/v1/index.js` (MODIFY)
Add: `const milestonesRouter = require('../milestones');`
Add: `router.use('/projects/:projectId/milestones', milestonesRouter);`

### `backend/src/services/TicketService.js` (MODIFY)
Add method `validateDependencies(ticketId)`:
1. Fetch ticket by id
2. If ticket.depends_on is null/empty → return
3. Fetch all dependency tickets by IDs
4. Filter for any where phase != 'done' and status != 'done'
5. If incomplete.length > 0 → throw ValidationError with list of blocking ticket titles

Call validateDependencies in the update() method when phase transitions to 'in_progress' or 'assigned'.

Add method `hasCircularDependency(ticketId, newDepIds)`:
1. Build adjacency map from all tickets in project
2. DFS cycle detection
3. If cycle detected → throw ValidationError

### `frontend/src/api/milestones.js` (CREATE)
```typescript
const BASE = '/api/v1/projects';

export async function listMilestones(projectId: string): Promise<Milestone[]> { ... }
export async function createMilestone(projectId: string, data: MilestoneCreate): Promise<Milestone> { ... }
export async function updateMilestone(id: string, data: MilestoneUpdate): Promise<Milestone> { ... }
export async function getMilestoneProgress(id: string): Promise<MilestoneProgress> { ... }
export async function getMilestoneTickets(id: string): Promise<Ticket[]> { ... }

interface Milestone { id: string; projectId: string; name: string; description: string | null; targetDate: string | null; isActive: boolean; createdAt: string; }
interface MilestoneCreate { name: string; description?: string; targetDate?: string; }
interface MilestoneProgress { totalEstimate: number; completedEstimate: number; percentage: number; }
```

### `frontend/src/views/ProjectDetail.vue` (MODIFY)
Add tab entry in the tabs navigation:
```html
<router-link :to="{ name: 'ProjectMilestones' }">Milestones</router-link>
```

Add child route definition for milestones tab.

### `frontend/src/components/MilestoneProgress.vue` (CREATE)
Props: `milestone: Milestone`, `progress: MilestoneProgress`
Renders: name, target date, progress bar (estimate vs completed), percentage text

### `frontend/src/components/NewMilestoneModal.vue` (CREATE)
Form fields: name (required), description (textarea), targetDate (date picker)
On submit: calls createMilestone API, closes modal, emits 'created'

### `frontend/src/components/TicketDependencyPicker.vue` (CREATE)
Props: `projectId`, `modelValue: string[]` (ticket IDs)
Fetches all tickets for project via API
Multi-select with search/filter
Emits `update:modelValue` with selected IDs

## Migration Plan
Apply migrations 025 and 026 in order via existing migrations/apply.js mechanism.

## Test Plan
1. Create milestone → verify it's active
2. Create second milestone → first is deactivated
3. Assign tickets to milestone → verify GET /milestones/:id/tickets
4. Add estimates → verify progress calculation
5. Add dependency A → B → try to start A → blocked
6. Complete B → try to start A → allowed
7. Try circular dependency → rejected

## Rollback Steps
1. Run 026_rollback.sql: ALTER TABLE tickets DROP COLUMN depends_on, DROP COLUMN estimate, DROP COLUMN milestone_id
2. Run 025_rollback.sql: DROP TABLE milestones
3. Revert frontend changes
4. Revert router changes
