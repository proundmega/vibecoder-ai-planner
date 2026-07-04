# 02_ARCHITECT_DESIGN.md — Ticket Status Transition Deduplication

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The `validTransitions` status transition rules are defined identically in two methods within `models/ticket.js` (`Ticket.update()` and `Ticket.updateStatus()`). This DRY violation means modifying transitions requires updating two places, increasing the risk of inconsistency.

---

## Current State

### Duplicate Definitions (`models/ticket.js`)

```javascript
// Line 82 — in static async update()
const validTransitions = {
  backlog: ['in_progress'],
  in_progress: ['review', 'backlog'],
  review: ['done', 'backlog'],
  done: [],
};
const allowed = validTransitions[current.status] || [];
if (!allowed.includes(status)) {
  throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
}

// Line 138 — in static async updateStatus()
const validTransitions = {
  'backlog': ['in_progress'],
  'in_progress': ['review', 'backlog'],
  'review': ['done', 'backlog'],
  'done': [],
};
const allowed = validTransitions[current.status] || [];
if (!allowed.includes(status)) {
  throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
}
```

### Gap Analysis
- Both definitions are functionally identical (only key quoting differs)
- The validation logic is also identical
- If a new transition is added (e.g., `review → in_progress`), it must be added in both places
- Risk: one definition could be updated while the other is missed

---

## Design

### Option A: Module-Level Constant (Recommended)

Move `validTransitions` to a module-level `const` at the top of `ticket.js`:

```javascript
// models/ticket.js

const validTransitions = {
  backlog: ['in_progress'],
  in_progress: ['review', 'backlog'],
  review: ['done', 'backlog'],
  done: [],
};

class Ticket {
  static async update(id, title, description, status, priority, assigneeId, userId) {
    const current = await Ticket.findById(id);
    if (current && status) {
      const allowed = validTransitions[current.status] || [];
      if (!allowed.includes(status)) {
        throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
      }
    }
    // ... rest of method
  }

  static async updateStatus(id, status, userId) {
    const current = await Ticket.findById(id);
    if (!current) throw new Error('Ticket not found');

    const allowed = validTransitions[current.status] || [];
    if (!allowed.includes(status)) {
      throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
    }
    // ... rest of method
  }
}
```

### Option B: Separate Module

Extract `validTransitions` to a separate file (`models/validTransitions.js`). Overkill for a single constant used only within `ticket.js`.

**Decision**: Option A is recommended. Simple, no new files, no circular dependency risks.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/models/ticket.js` | MODIFY | Extract `validTransitions` to module-level constant; replace inline definitions |

---

## Dependencies

- No new npm dependencies
- No backend changes

---

## Config / Environment Changes

- No new environment variables

---

## Security Considerations

- [x] No security impact — this is a code quality improvement

---

## Risks and Edge Cases

### Backend Risks
- **[None expected]**: This is a pure refactoring change. The validation logic remains identical.

### Edge Cases
- **[Test coverage]**: The existing tests in `__tests__/unit.test.js` define their own `validTransitions` array for testing. This is fine — it tests the transition rules independently of the model.

---

## Alternative Designs Considered

### Alternative 1: Separate module for validTransitions
- **Pros**: Can be shared across other models/services
- **Cons**: Overkill for a single constant used only within `ticket.js`; adds a new file
- **Decision**: Keep it in `ticket.js`. If other modules need shared transitions later, extract then.

### Alternative 2: Database-driven transitions
- **Pros**: Transitions can be changed without code changes
- **Cons**: Over-engineering; ticket transitions are a core business rule that rarely changes
- **Decision**: Not needed. Hardcoded constant is appropriate for this use case.
