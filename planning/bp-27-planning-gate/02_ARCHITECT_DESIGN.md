# bp-27: Make Planning a Gate — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend

## Current State

PhaseService (bp-26) allows `planning → plan_approved` unconditionally. The TicketPlanningService already tracks `planning_status` per ticket — it can be `none`, `in_progress`, or `completed`. The data exists, it's just not enforced.

## Proposed Solution

### Gate Check Logic

Add a `_gateChecks` method to PhaseService that runs before transition:

```javascript
async function _checkGates(ticketId, toPhase) {
    const gates = {
        'plan_approved': async (ticketId) => {
            const status = await ticketPlanningService.getPlanningStatus(ticketId);
            if (status !== 'completed') {
                return { passed: false, reason: 'Planning not completed. Current status: ' + status };
            }
            return { passed: true };
        },
    };
    const check = gates[toPhase];
    if (check) return await check(ticketId);
    return { passed: true };  // no gate check for other phases
}
```

### Integration

In `PhaseService.transition()`, after validating the transition is allowed but before executing:

```javascript
const gateResult = await this._checkGates(ticketId, toPhase);
if (!gateResult.passed) {
    throw new Error(gateResult.reason);
}
```

### What Gate Status Returns

```javascript
async getGateStatus(ticketId, phase) {
    const gate = gates[phase];
    if (!gate) return { phase, gate: 'none', passed: true };
    return await gate(ticketId);
}
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/PhaseService.js` | MODIFY | Add _checkGates() and getGateStatus() methods |

## Alternatives Considered

- **Alternative: Make PhaseService accept a gate configuration object** — Overengineered for now. Hardcoded gates are simpler and the gate list is small.
