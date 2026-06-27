# bp-39: Milestones & Timeline — Spec

**Target model**: 14B–34B (Express.js + Vue 3 + TypeScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/025_milestones.sql`
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

COMMENT ON TABLE milestones IS 'Project milestones with one-active constraint per project';
```

### CREATE: `backend/src/migrations/026_ticket_milestone_fields.sql`
```sql
-- Migration: 026_ticket_milestone_fields.sql
ALTER TABLE tickets ADD COLUMN milestone_id UUID REFERENCES milestones(id) ON DELETE SET NULL;
ALTER TABLE tickets ADD COLUMN estimate INTEGER CHECK (estimate IS NULL OR estimate > 0);
ALTER TABLE tickets ADD COLUMN depends_on UUID[] DEFAULT ARRAY[]::UUID[];

CREATE INDEX idx_tickets_milestone ON tickets(milestone_id);
```

### CREATE: `backend/src/services/MilestoneService.js`

**Imports**:
```javascript
const { pool } = require('../db');
const { ValidationError, NotFoundError } = require('../errors/HttpError');
```

**Class**: `MilestoneService`

**Methods** (static):
```javascript
static async list(projectId)
  1. result = await pool.query('SELECT * FROM milestones WHERE project_id = $1 ORDER BY created_at DESC', [projectId])
  2. return result.rows

static async create(projectId, { name, description, targetDate })
  1. if (!name || name.trim().length === 0) throw new ValidationError('Milestone name is required')
  2. const client = await pool.connect()
  3. try {
       await client.query('BEGIN')
       await client.query('UPDATE milestones SET is_active=false WHERE project_id=$1 AND is_active=true', [projectId])
       const result = await client.query(
         'INSERT INTO milestones (project_id, name, description, target_date) VALUES ($1, $2, $3, $4) RETURNING *',
         [projectId, name.trim(), description || null, targetDate || null]
       )
       await client.query('COMMIT')
       return result.rows[0]
     } catch (e) { await client.query('ROLLBACK'); throw e }
     finally { client.release() }

static async update(id, { name, description, targetDate })
  1. const sets = []; const vals = []; let idx = 1
  2. if (name !== undefined) { sets.push('name=$' + idx++); vals.push(name.trim()) }
  3. if (description !== undefined) { sets.push('description=$' + idx++); vals.push(description) }
  4. if (targetDate !== undefined) { sets.push('target_date=$' + idx++); vals.push(targetDate) }
  5. if (sets.length === 0) throw new ValidationError('No fields to update')
  6. vals.push(id)
  7. result = await pool.query(`UPDATE milestones SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`, vals)
  8. if (result.rows.length === 0) throw new NotFoundError('Milestone not found')
  9. return result.rows[0]

static async getProgress(id)
  1. result = await pool.query(`
       SELECT
         COALESCE(SUM(estimate), 0) AS total_estimate,
         COALESCE(SUM(estimate) FILTER (WHERE phase = 'done' OR status = 'done'), 0) AS completed_estimate
       FROM tickets WHERE milestone_id = $1`, [id])
  2. const { total_estimate, completed_estimate } = result.rows[0]
  3. const percentage = total_estimate > 0 ? Math.round((completed_estimate / total_estimate) * 100) : 0
  4. return { totalEstimate: Number(total_estimate), completedEstimate: Number(completed_estimate), percentage }

static async getTickets(id)
  1. result = await pool.query('SELECT * FROM tickets WHERE milestone_id = $1 ORDER BY created_at', [id])
  2. return result.rows
```

### MODIFY: `backend/src/services/TicketService.js`

**Add method**:
```javascript
async validateDependencies(ticketId) {
  const ticket = await Ticket.findById(ticketId);
  if (!ticket) throw new NotFoundError('Ticket not found');
  if (!ticket.depends_on || ticket.depends_on.length === 0) return;

  const deps = await Ticket.findByIds(ticket.depends_on);
  const incomplete = deps.filter(d =>
    d.status !== 'done' && d.phase !== 'done' && d.phase !== 'deployed'
  );
  if (incomplete.length > 0) {
    throw new ValidationError(
      `Cannot start: the following dependencies are not done: ${incomplete.map(d => d.title).join(', ')}`
    );
  }
}

async hasCircularDependency(ticketId, newDepIds, allProjectTickets) {
  // Build adjacency map from all tickets in the project
  const adjMap = new Map();
  for (const t of allProjectTickets) {
    adjMap.set(t.id.toString(), (t.depends_on || []).map(String));
  }
  // Override with the new dependency set for the ticket being updated
  adjMap.set(String(ticketId), newDepIds.map(String));

  const visited = new Set();
  const recStack = new Set();

  function dfs(id) {
    if (recStack.has(id)) return true;
    if (visited.has(id)) return false;
    visited.add(id);
    recStack.add(id);
    const deps = adjMap.get(id) || [];
    for (const depId of deps) {
      if (dfs(depId)) return true;
    }
    recStack.delete(id);
    return false;
  }

  if (dfs(String(ticketId))) {
    throw new ValidationError('Circular dependency detected');
  }
}
```

**Modify `update()` method**:
```javascript
// After data normalization, before DB update:
if (data.milestone_id !== undefined) {
  // Validate milestone exists and belongs to same project
}
if (data.estimate !== undefined) {
  if (data.estimate !== null && (typeof data.estimate !== 'number' || data.estimate <= 0)) {
    throw new ValidationError('Estimate must be a positive integer');
  }
}
if (data.depends_on !== undefined) {
  await this.hasCircularDependency(id, data.depends_on, await Ticket.findByProject(ticket.project_id));
}
```

### CREATE: `backend/src/api/milestones.js`

**Routes**:
```
GET    /api/v1/projects/:projectId/milestones       → list
POST   /api/v1/projects/:projectId/milestones       → create
PUT    /api/v1/milestones/:id                       → update
GET    /api/v1/milestones/:id/tickets               → getTickets
GET    /api/v1/milestones/:id/progress              → getProgress
```

All routes require `verifyToken` middleware. POST requires `requireAnyPermission('PROJECT_UPDATE')`.

### CREATE: `frontend/src/api/milestones.ts`

**Functions**:
```typescript
import { api } from './client';

export interface Milestone {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  target_date: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MilestoneProgress {
  total_estimate: number;
  completed_estimate: number;
  percentage: number;
}

export async function listMilestones(projectId: string): Promise<Milestone[]> {
  const res = await api(`/api/v1/projects/${projectId}/milestones`);
  return res.data ?? [];
}

export async function createMilestone(projectId: string, data: { name: string; description?: string; targetDate?: string }): Promise<Milestone> {
  return api(`/api/v1/projects/${projectId}/milestones`, { method: 'POST', body: data });
}

export async function updateMilestone(id: string, data: Partial<Milestone>): Promise<Milestone> {
  return api(`/api/v1/milestones/${id}`, { method: 'PUT', body: data });
}

export async function getMilestoneProgress(id: string): Promise<MilestoneProgress> {
  return api(`/api/v1/milestones/${id}/progress`);
}

export async function getMilestoneTickets(id: string): Promise<Ticket[]> {
  return api(`/api/v1/milestones/${id}/tickets`);
}
```

### MODIFY: `frontend/src/views/ProjectDetail.vue`

**Add to tabs** (after templates tab):
```html
<router-link
  :to="{ name: 'ProjectMilestones' }"
  class="tab"
  active-class="tab--active"
>Milestones</router-link>
```

**Add child route** (in router, under ProjectDetail children):
```typescript
{
  path: 'milestones',
  name: 'ProjectMilestones',
  component: () => import('../views/ProjectMilestones.vue'),
  meta: { requiresAuth: true },
}
```

### CREATE: `frontend/src/views/ProjectMilestones.vue`

Renders:
- Active milestone card with progress bar (reuses MilestoneProgress)
- List of all milestones (past/deactivated) below
- "New Milestone" button → opens NewMilestoneModal
- Clicking a milestone shows its tickets with phase badges

### CREATE: `frontend/src/components/MilestoneProgress.vue`

```vue
<template>
  <div class="milestone-progress">
    <div class="milestone-header">
      <strong>{{ milestone.name }}</strong>
      <span v-if="milestone.target_date" class="text-muted">Target: {{ milestone.target_date }}</span>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" :style="{ width: progress.percentage + '%' }"></div>
    </div>
    <div class="progress-text">
      {{ progress.completedEstimate }} / {{ progress.totalEstimate }} points ({{ progress.percentage }}%)
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Milestone, MilestoneProgress } from '../api/milestones'
defineProps<{ milestone: Milestone; progress: MilestoneProgress }>()
</script>
```

## Test Expectations

### Integration
```
✓ Create milestone → 201, milestone returned with is_active=true
✓ Create second milestone → first is_active=false, second is_active=true
✓ Update milestone name → 200 with updated name
✓ Get milestone progress with tickets with estimates → correct percentage
✓ Get milestone progress with no tickets → 0/0/0%
✓ Get milestone tickets → returns only tickets in that milestone
✓ Assign depends_on without cycles → OK
✓ Assign depends_on with self-reference → 400 ValidationError
✓ Assign depends_on with circular path → 400 ValidationError
✓ Transition to in_progress with unmet deps → 400 ValidationError
✓ Transition to in_progress with all deps done → OK
```

## Edge Cases to Handle

1. **Milestone with same name**: No uniqueness constraint — allowed for different time periods
2. **Delete project**: CASCADE deletes all milestones; tickets milestone_id set to NULL
3. **Delete milestone**: tickets.milestone_id set to NULL via ON DELETE SET NULL
4. **Estimate zero/negative**: DB CHECK constraint rejects, backend also validates
5. **Dependency on non-existent ticket**: UUID reference fails; validate in backend
6. **Target date in past**: Allowed — milestone still shows in list
7. **No active milestone**: Allowed — tickets can exist without milestone assignment

## Existing Code Patterns to Follow

- UUID primary keys for new tables (existing pattern)
- snake_case in DB, camelCase in API responses (via explicit mapping)
- API response format: `{ success: true, data: ... }`
- Backend services are classes with static methods
- Frontend API calls through `api()` helper from `api/client.js` which strips `.data`
- Router lazy-loads components via `() => import(...)`
- Child routes under ProjectDetail for tabs
