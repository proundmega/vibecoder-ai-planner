# bp-26: Add Phase Column + PhaseService — Spec

**Target model**: 14B (JavaScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/018_ticket_phases.sql`

```sql
-- Add phase column to tickets
ALTER TABLE tickets ADD COLUMN phase VARCHAR(32) NOT NULL DEFAULT 'draft';

-- Map existing statuses to phases
UPDATE tickets SET phase = 'draft' WHERE status = 'backlog';
UPDATE tickets SET phase = 'in_progress' WHERE status = 'in_progress';
UPDATE tickets SET phase = 'review' WHERE status = 'review';
UPDATE tickets SET phase = 'done' WHERE status = 'done';

-- Phase transition log
CREATE TABLE ticket_phases (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    from_phase VARCHAR(32),
    to_phase VARCHAR(32) NOT NULL,
    actor_type VARCHAR(16) NOT NULL DEFAULT 'system',
    actor_id VARCHAR(64),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_phases_ticket ON ticket_phases(ticket_id);
```

### CREATE: `backend/src/migrations/018_ticket_phases_rollback.sql`

```sql
DROP TABLE IF EXISTS ticket_phases;
ALTER TABLE tickets DROP COLUMN IF EXISTS phase;
```

### MODIFY: `backend/src/migrations/apply.js`

Add `'018_ticket_phases'` to the SQL_FILES array after `'017_agent_memory_fallback'`.

### CREATE: `backend/src/services/PhaseService.js`

**Imports**:
```javascript
const db = require('../db');
```

**ALLOWED_TRANSITIONS** (static property):
```javascript
const ALLOWED_TRANSITIONS = {
    draft: ['planning'],
    planning: ['plan_approved', 'draft'],
    plan_approved: ['assigned', 'planning'],
    assigned: ['in_progress', 'planning'],
    in_progress: ['review', 'blocked', 'backlog'],
    blocked: ['in_progress'],
    review: ['human_approval', 'in_progress', 'backlog'],
    human_approval: ['done', 'review'],
    done: ['deployed', 'in_progress'],
    deployed: ['done'],
};
```

**Methods**:
```javascript
async function transition(ticketId, toPhase, actorType = 'system', actorId = null, metadata = {})
  1. const { rows } = await db.pool.query('SELECT phase FROM tickets WHERE id = $1', [ticketId])
  2. if (rows.length === 0) throw new Error('Ticket not found')
  3. const currentPhase = rows[0].phase
  4. const allowed = ALLOWED_TRANSITIONS[currentPhase] || []
  5. if (!allowed.includes(toPhase)) throw new Error(
       `Cannot transition from '${currentPhase}' to '${toPhase}'. Allowed: ${allowed.join(', ')}`)
  6. await db.pool.query('UPDATE tickets SET phase = $1 WHERE id = $2', [toPhase, ticketId])
  7. await db.pool.query(
       'INSERT INTO ticket_phases (ticket_id, from_phase, to_phase, actor_type, actor_id, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
       [ticketId, currentPhase, toPhase, actorType, actorId, JSON.stringify(metadata)])
  8. return { ticketId, from: currentPhase, to: toPhase }

async function getCurrentPhase(ticketId)
  → SELECT phase FROM tickets WHERE id = $1 → return phase or null

async function getAllowedNextPhases(ticketId)
  → const phase = await getCurrentPhase(ticketId)
  → return ALLOWED_TRANSITIONS[phase] || []

async function getPhaseHistory(ticketId)
  → SELECT * FROM ticket_phases WHERE ticket_id = $1 ORDER BY created_at ASC
  → return rows
```

**Exports**:
```javascript
module.exports = { transition, getCurrentPhase, getAllowedNextPhases, getPhaseHistory, ALLOWED_TRANSITIONS };
```

### MODIFY: `backend/src/models/ticket.js`

**In fromRow()**, add `phase: row.phase` to the returned object.

**In the column list for CREATE** (if there is one), add `phase`.

### MODIFY: `backend/src/api/tickets.js`

**Add routes** (after existing ticket routes):

```javascript
const phaseService = require('../../services/PhaseService');

// GET /tickets/:id/phases — phase history
router.get('/:id/phases', verifyToken, async (req, res) => {
    const history = await phaseService.getPhaseHistory(req.params.id);
    res.json({ success: true, data: history });
});

// POST /tickets/:id/phases/transition — transition to new phase
router.post('/:id/phases/transition', verifyToken, async (req, res) => {
    const { toPhase, metadata } = req.body;
    const result = await phaseService.transition(req.params.id, toPhase, 'human', req.user.userId, metadata);
    res.json({ success: true, data: result });
});
```

**Imports to add** at top:
```javascript
const phaseService = require('../../services/PhaseService');
```

## Test Expectations

### PhaseService tests
```
✓ transition('draft' → 'planning') succeeds
✓ transition('draft' → 'review') throws "Cannot transition from 'draft' to 'review'"
✓ getCurrentPhase returns correct phase after transition
✓ getAllowedNextPhases returns only valid targets
✓ getPhaseHistory returns chronological transition list
✓ Phase transition is logged in ticket_phases table
```

## Edge Cases to Handle

1. **Transition to same phase**: currently not in allowed transitions — use case TBD
2. **Ticket not found**: throw descriptive error
3. **Null/invalid toPhase**: handled by allowed transition check
4. **Existing tickets**: migration maps status→phase so no data loss
