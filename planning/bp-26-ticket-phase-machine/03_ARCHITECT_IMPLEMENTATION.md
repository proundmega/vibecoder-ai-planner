# bp-26: Add Phase Column + PhaseService — Implementation

**Status**: planned
**Priority**: P0
**Effort**: Medium
**Scope**: Backend

## Purpose
Add phase machine foundation: new column, transition validation, and audit log.

## Implementation Order

1. **Create migration files** — `backend/src/migrations/018_ticket_phases.sql` + rollback
   - Add phase column, map existing statuses, create ticket_phases log table
   - Update `backend/src/migrations/apply.js` to include 018
   - *Depends on*: nothing

2. **Create PhaseService.js** — `backend/src/services/PhaseService.js`
   - ALLOWED_TRANSITIONS map
   - transition(), getAllowedNextPhases(), getCurrentPhase(), getPhaseHistory()
   - *Depends on*: nothing

3. **Modify TicketService.js** — `backend/src/services/TicketService.js`
   - On status change, also update phase (map via ALLOWED_TRANSITIONS)
   - Call PhaseService.transition() whenever phase changes
   - *Depends on*: Step 2

4. **Modify ticket model** — `backend/src/models/ticket.js`
   - Add phase field to fromRow(), field list
   - *Depends on*: Step 1

5. **Add phase endpoints** — `backend/src/api/tickets.js`
   - GET /tickets/:id/phases — phase history
   - POST /tickets/:id/phases/transition — { toPhase, metadata }
   - *Depends on*: Steps 2-4

## Per-File Action Plan

### `backend/src/migrations/018_ticket_phases.sql` (CREATE)
- ALTER TABLE tickets ADD COLUMN phase VARCHAR(32) NOT NULL DEFAULT 'draft'
- UPDATE tickets SET phase = ... based on status mapping
- CREATE TABLE ticket_phases (id UUID PK, ticket_id FK, from_phase, to_phase, actor_type, actor_id, metadata JSONB, created_at)
- CREATE INDEX idx_ticket_phases_ticket

### `backend/src/services/PhaseService.js` (CREATE)
- Static ALLOWED_TRANSITIONS map
- `async transition(ticketId, toPhase, actorType, actorId, metadata)`:
  1. Get current phase from DB
  2. Validate toPhase is in allowed transitions for current phase
  3. UPDATE tickets SET phase = toPhase
  4. INSERT into ticket_phases log
  5. Return updated ticket
- `async getAllowedNextPhases(ticketId)` — returns array
- `async getCurrentPhase(ticketId)` — returns string
- `async getPhaseHistory(ticketId)` — returns array of {from, to, actorType, createdAt}

### `backend/src/services/TicketService.js` (MODIFY)
- In update()/changeStatus(), after status update, also map status to phase:
  - backlog→draft, in_progress→in_progress, review→review, done→done
  - Call `phaseService.transition(...)` with actor info

### `backend/src/models/ticket.js` (MODIFY)
- Add `phase` to the field list in fromRow()
- Add `phase` to CREATE TABLE field list if applicable

### `backend/src/api/tickets.js` (MODIFY)
- Add routes for phase transitions
- Follow existing patterns (verifyToken middleware, error handling)

## Test Plan
1. Run migration 018
2. Verify existing tickets get correct initial phase
3. Test PhaseService.transition() with valid and invalid transitions
4. Test backward compatibility: existing status-based flow still works

## Rollback Steps
1. `node src/migrations/rollback.js 018` — reverts phase column and ticket_phases table
2. Remove 018 from apply.js SQL_FILES array
