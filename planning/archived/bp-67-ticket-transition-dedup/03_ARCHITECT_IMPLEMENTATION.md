# 03_ARCHITECT_IMPLEMENTATION.md — Ticket Status Transition Deduplication

**Status**: planned
**Priority**: P3
**Effort**: Small
**Author**: AI Assistant
**Date created**: {{YYYY-MM-DD}}
**Date completed**: {{YYYY-MM-DD}}
**PR**: {{link}}
**Branch**: {{branch-name}}
**Scope**: Backend

**Dependencies**: None

---

### a) Purpose

Deduplicate the `validTransitions` status transition rules in `models/ticket.js` by extracting them to a single module-level constant, eliminating the DRY violation and reducing the risk of inconsistent transition rules.

---

### b) Actions

#### Implementation Order

Steps must be executed in this exact order:

1. **Extract validTransitions to module-level constant** — `backend/src/models/ticket.js`
   - Move `validTransitions` from inline `const` declarations to a module-level `const` at the top of the file
   - Replace both inline definitions with references to the shared constant
   - *Depends on*: nothing

2. **Run tests** — verify all tests pass
   - `npm test` — unit tests
   - *Depends on*: Step 1

---

### c) Per-File Action Plan

#### `backend/src/models/ticket.js` (MODIFY)

**Before** (two inline definitions):
```javascript
class Ticket {
  static async update(id, title, description, status, priority, assigneeId, userId) {
    const current = await Ticket.findById(id);
    if (current && status) {
      const validTransitions = {
        backlog: ['in_progress'],
        in_progress: ['review', 'backlog'],
        review: ['done', 'backlog'],
        done: [],
      };
      const allowed = validTransitions[current.status] || [];
      // ...
    }
  }

  static async updateStatus(id, status, userId) {
    const current = await Ticket.findById(id);
    if (!current) throw new Error('Ticket not found');

    const validTransitions = {
      'backlog': ['in_progress'],
      'in_progress': ['review', 'backlog'],
      'review': ['done', 'backlog'],
      'done': [],
    };
    const allowed = validTransitions[current.status] || [];
    // ...
  }
}
```

**After** (single module-level constant):
```javascript
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
    // ... rest unchanged
  }

  static async updateStatus(id, status, userId) {
    const current = await Ticket.findById(id);
    if (!current) throw new Error('Ticket not found');

    const allowed = validTransitions[current.status] || [];
    if (!allowed.includes(status)) {
      throw new ValidationError(`Invalid status transition from ${current.status} to ${status}`);
    }
    // ... rest unchanged
  }
}
```

---

### d) Dependencies

- No new npm dependencies

---

### e) Risks/Edge Cases

- **[None expected]**: This is a pure refactoring change. The validation logic remains identical.

---

### f) Testing

#### Backend Unit Tests
- [ ] `npm test` — all unit tests pass
- [ ] Verify `Ticket.update()` rejects invalid transitions
- [ ] Verify `Ticket.updateStatus()` rejects invalid transitions
- [ ] Verify all valid transitions still work (backlog→in_progress, in_progress→review, review→done, etc.)

#### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors

---

### g) Migration Notes

No database migrations. No backend changes.

---

### h) Files Changed

**Backend:**
```
backend/src/models/ticket.js    → MODIFY (extract validTransitions to module-level)
```

---

### i) Code Review Checklist

- [ ] Only one `validTransitions` definition in `ticket.js`
- [ ] Both `Ticket.update()` and `Ticket.updateStatus()` reference the shared constant
- [ ] `npm test` passes
- [ ] No circular dependencies introduced

---

### j) Post-Deploy Verification

1. [ ] `npm test` — backend unit tests pass
2. [ ] `npm run lint` — no lint errors
3. [ ] `grep -c "validTransitions" backend/src/models/ticket.js` returns 1 (one definition + two references)
4. [ ] Ticket status transitions work correctly for all valid paths
5. [ ] Invalid transitions are rejected with proper error messages
