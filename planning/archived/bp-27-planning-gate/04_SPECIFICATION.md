# bp-27: Make Planning a Gate — Spec

**Target model**: 14B (JavaScript)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/src/services/PhaseService.js`

**Add import** at the top (after `const db = require('../db')`):
```javascript
const ticketPlanningService = require('./TicketPlanningService');
```

**Add private helper** before the exports:
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

**In `transition()` function**, after the allowed-transition check and before the UPDATE, add:
```javascript
const gateResult = await _checkGates(ticketId, toPhase);
if (!gateResult.passed) {
    const err = new Error(gateResult.reason);
    err.statusCode = 400;
    throw err;
}
```

**Add new exported function**:
```javascript
async function getGateStatus(ticketId) {
    const phase = await getCurrentPhase(ticketId);
    const allowed = ALLOWED_TRANSITIONS[phase] || [];
    const gates = {};
    for (const p of allowed) {
        gates[p] = await _checkGates(ticketId, p);
    }
    return { currentPhase: phase, gates };
}
```

**Update module.exports** to include `getGateStatus`:
```javascript
module.exports = { transition, getCurrentPhase, getAllowedNextPhases, getPhaseHistory, getGateStatus, ALLOWED_TRANSITIONS };
```

## Test Expectations

```
✓ transition(ticketId, 'plan_approved') fails if planning_status != 'completed'
✓ getGateStatus(ticketId).gates['plan_approved'].passed = false when planning not done
✓ getGateStatus(ticketId).gates['plan_approved'].passed = true after planning completed
✓ Other transitions (draft→planning) pass gate check unconditionally
```

## Edge Cases to Handle

1. **Ticket with no planning docs**: getPlanningStatus returns 'none' → gate fails
2. **Ticket planning in progress**: getPlanningStatus returns 'in_progress' → gate fails
3. **Phase with no gates**: _checkGates returns { passed: true } for unlisted phases
