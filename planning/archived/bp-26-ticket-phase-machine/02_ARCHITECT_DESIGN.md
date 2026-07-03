# bp-26: Add Phase Column + PhaseService — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend

## Current State

Tickets have a `status` column: `backlog | in_progress | review | done`. Transitions are validated in `TicketService.js`:

```javascript
const ALLOWED_TRANSITIONS = {
    backlog: ['in_progress'],
    in_progress: ['review', 'backlog'],
    review: ['done', 'backlog'],
    done: [],  // terminal
};
```

No concept of "phase." No guidance. No enforcement of planning before coding.

## Proposed Solution

### Phase Enum

```
draft → planning → plan_approved → assigned → in_progress → review → human_approval → done → deployed
                                                                    │
                                                               blocked (accessible from any phase)
```

### Database Migration

**Migration 018:**
```sql
-- Add phase column to tickets with existing status mapping
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
    actor_type VARCHAR(16) NOT NULL DEFAULT 'system',  -- 'human', 'agent', 'system'
    actor_id VARCHAR(64),  -- user UUID or agent UUID
    metadata JSONB,  -- freeform context
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ticket_phases_ticket ON ticket_phases(ticket_id);
```

### PhaseService

```javascript
class PhaseService {
    // Master transition map
    static ALLOWED_TRANSITIONS = {
        draft: ['planning'],
        planning: ['plan_approved', 'draft'],
        plan_approved: ['assigned', 'planning'],
        assigned: ['in_progress', 'planning'],
        in_progress: ['review', 'blocked', 'backlog'],
        blocked: ['in_progress'],  // agent resumes after human answer
        review: ['human_approval', 'in_progress', 'backlog'],
        human_approval: ['done', 'review'],
        done: ['deployed', 'in_progress'],  // reopen possible
        deployed: ['done'],  // rollback
    };

    async transition(ticketId, toPhase, actorType, actorId, metadata) { ... }
    async getAllowedNextPhases(ticketId) { ... }
    async getCurrentPhase(ticketId) { ... }
    async getPhaseHistory(ticketId) { ... }
    async getGateStatus(ticketId, phase) { ... }  // what's blocking the gate
}
```

### Error Handling

| Situation | Response |
|-----------|----------|
| Invalid transition (e.g., draft → review) | 400, "Cannot transition from 'draft' to 'review'. Allowed: planning" |
| Ticket not found | 404 |
| Phase gate not met (e.g., planning incomplete) | 400, "Gate 'planning_complete' not passed" |

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/018_ticket_phases.sql` | CREATE | Add phase column + ticket_phases table |
| `backend/src/migrations/018_ticket_phases_rollback.sql` | CREATE | Revert migration |
| `backend/src/migrations/apply.js` | MODIFY | Add 018 to SQL_FILES array after 017 |
| `backend/src/services/PhaseService.js` | CREATE | Transition validation + logging |
| `backend/src/services/TicketService.js` | MODIFY | Call PhaseService on status/phase changes |
| `backend/src/models/ticket.js` | MODIFY | Add phase to row mapping |
| `backend/src/api/tickets.js` | MODIFY | Add phase endpoints |
