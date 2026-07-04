# bp-27: Make Planning a Gate — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Small
**Scope**: Backend

## Purpose
Prevent tickets from reaching `plan_approved` without completed planning docs.

## Implementation Order

1. **Modify PhaseService.js** — Add _checkGates() and getGateStatus()
   - Add ticketingPlanningService import
   - Add gate check for `plan_approved` phase
   - Call _checkGates() inside transition() before executing
   - *Depends on*: bp-26

## Per-File Action Plan

### `backend/src/services/PhaseService.js` (MODIFY)

**Add import** (top of file):
```javascript
const ticketPlanningService = require('./TicketPlanningService');
```

**Add private gate check method**:
```javascript
async function _checkGates(ticketId, toPhase) {
    const gates = {
        'plan_approved': async (id) => {
            const status = await ticketPlanningService.getPlanningStatus(id);
            if (status !== 'completed') {
                return { passed: false, reason: `Planning not completed. Current status: ${status}` };
            }
            return { passed: true, reason: null };
        },
    };
    const check = gates[toPhase];
    return check ? await check(ticketId) : { passed: true, reason: null };
}
```

**Modify transition()** to call _checkGates before committing:
```javascript
// After allowed transition check, before UPDATE/INSERT:
const gateResult = await _checkGates(ticketId, toPhase);
if (!gateResult.passed) {
    const err = new Error(gateResult.reason);
    err.statusCode = 400;
    throw err;
}
```

**Add getGateStatus method**:
```javascript
async function getGateStatus(ticketId) {
    const currentPhase = await getCurrentPhase(ticketId);
    const allowedNext = ALLOWED_TRANSITIONS[currentPhase] || [];
    const gates = {};
    for (const phase of allowedNext) {
        const result = await _checkGates(ticketId, phase);
        gates[phase] = result;
    }
    return { currentPhase, gates };
}
```

**Export the new method**:
```javascript
module.exports = { transition, getCurrentPhase, getAllowedNextPhases, getPhaseHistory, getGateStatus, ALLOWED_TRANSITIONS };
```

## Test Plan
1. Create ticket, verify phase = draft
2. Transition to planning → succeeds
3. Try to transition to plan_approved → fails because planning not completed
4. Complete planning via TicketPlanningService
5. Transition to plan_approved → succeeds
