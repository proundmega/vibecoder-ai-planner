# 01_ARCHITECT_REQUIREMENT.md — Ticket Status Transition Deduplication

**Status**: planned
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend
**Priority**: P3
**Effort**: Small

---

## Requirement

Deduplicate the `validTransitions` status transition rules that are defined identically in two methods within `models/ticket.js`. Currently, both `Ticket.update()` (line 82) and `Ticket.updateStatus()` (line 138) define their own copy of the same transition rules, violating the DRY principle and creating a risk that the definitions will drift apart if transitions are modified in one place but not the other.

**Problem**: `backend/src/models/ticket.js` has two identical `validTransitions` definitions:

```javascript
// Line 82 — in Ticket.update()
const validTransitions = {
  backlog: ['in_progress'],
  in_progress: ['review', 'backlog'],
  review: ['done', 'backlog'],
  done: [],
};

// Line 138 — in Ticket.updateStatus()
const validTransitions = {
  'backlog': ['in_progress'],
  'in_progress': ['review', 'backlog'],
  'review': ['done', 'backlog'],
  'done': [],
};
```

Both definitions are functionally identical (only key quoting differs). If a new valid transition is added, it must be added in both places, increasing the risk of inconsistency.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend Code Check
- [x] `models/ticket.js:82` — `validTransitions` in `Ticket.update()` method
- [x] `models/ticket.js:138` — `validTransitions` in `Ticket.updateStatus()` method
- [x] Both definitions are identical (only key quoting differs: `'backlog'` vs `backlog`)
- [x] `validTransitions` is NOT referenced anywhere else in the codebase (grep confirmed)
- [x] `services/TicketService.js` does NOT define its own `validTransitions`
- [x] `__tests__/unit.test.js:19` — defines its own `validTransitions` array for testing (not related to the model)

### Key Insight
This is BACKEND-ONLY. The fix is extracting the shared constant to a module-level definition.

---

## Scope

### In Scope
- Extract `validTransitions` to a module-level constant in `models/ticket.js`
- Replace both inline definitions with references to the shared constant
- Ensure both `Ticket.update()` and `Ticket.updateStatus()` use the shared definition
- Verify all existing tests pass

### Out of Scope
- Changing the transition rules themselves
- Adding new transitions
- Moving `validTransitions` to a separate shared module (overkill for this single use)
- Changing the validation logic (only the definition location changes)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/models/ticket.js` | MODIFY | Extract `validTransitions` to module-level constant; replace inline definitions |
| `backend/src/__tests__/unit.test.js` | NONE | Has its own `validTransitions` array for testing — unrelated to the model |

---

## Known Unknowns

1. **[Circular dependency]**: If `validTransitions` is moved to a separate module, could it create circular dependencies with `TicketService`? — Not applicable since we're keeping it in `ticket.js` as a module-level constant.

---

## Important Design Decisions

1. **Module-level constant in ticket.js**: Keep `validTransitions` in `models/ticket.js` as a `const` at the top of the file. This avoids creating a new file and eliminates circular dependency risks.
2. **No separate module**: Overkill to create a `validTransitions.js` file for a single constant used only within `ticket.js`.

---

## Acceptance Criteria

1. [ ] Only one `validTransitions` definition exists in `models/ticket.js` (module-level)
2. [ ] `Ticket.update()` references the shared `validTransitions`
3. [ ] `Ticket.updateStatus()` references the shared `validTransitions`
4. [ ] Both methods validate transitions correctly
5. [ ] All existing tests pass
6. [ ] No circular dependencies introduced

---

## Out of Scope

- Changing the transition rules themselves
- Adding new transitions
- Moving `validTransitions` to a separate shared module
- Changing the validation logic

---

## Security Considerations

- [x] No security impact — this is a code quality improvement

---

## Testing Checklist

### Backend Tests
- [ ] `npm test` — all unit tests pass
- [ ] Verify `Ticket.update()` rejects invalid transitions
- [ ] Verify `Ticket.updateStatus()` rejects invalid transitions
- [ ] Verify all valid transitions still work

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
