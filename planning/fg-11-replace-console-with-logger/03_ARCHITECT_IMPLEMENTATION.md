# 03_ARCHITECT_IMPLEMENTATION.md — Replace console.error with User-Facing Errors

---

## Ticket: fg-11 — Replace console.error with user-facing error states

**Status**: planned
**Priority**: P2
**Effort**: Medium
**Author**: AI Assistant
**Date created**: 2026-06-29
**Scope**: Frontend

**Dependencies**: None

---

### a) Purpose

Replace `console.error()` calls in frontend views with proper reactive error state refs that display inline error messages to users, consistent with the rest of the project.

---

### b) Actions

#### Implementation Order

1. **Fix ProjectMilestones.vue** — `frontend/src/views/ProjectMilestones.vue`
   - Add `const error = ref(null)` state variable
   - Replace `console.error('Failed to create milestone:', err)` with `error.value = 'Failed to create milestone'`
   - Replace `console.error('Failed to fetch milestones:', err)` with `error.value = 'Failed to load milestones'`
   - Replace `console.error('Failed to fetch milestone details:', err)` with `error.value = 'Failed to load milestone details'`
   - Add template display: `<div v-if="error" class="error">{{ error }}</div>`
   - *Depends on*: nothing

2. **Fix ComputeNodes.vue** — `frontend/src/views/ComputeNodes.vue`
   - Add `const error = ref(null)` state variable
   - Replace all 5 `console.error('Failed to ...', err)` with `error.value = 'Failed to ...'`
   - Add template display: `<div v-if="error" class="error">{{ error }}</div>`
   - Add loading state guard: don't show error until after loading completes
   - *Depends on*: nothing

---

### c) Per-File Action Plan

#### `frontend/src/views/ProjectMilestones.vue` (MODIFY)

**Add state variable after existing `reload` or loading state:**
```javascript
const error = ref(null)
```

**Modify catch blocks:**
```javascript
// Before:
console.error('Failed to fetch milestones:', err)
// After:
error.value = 'Failed to load milestones'
```

**Add to template** (after loading check, before content):
```html
<div v-if="error" class="error">{{ error }}</div>
```

#### `frontend/src/views/ComputeNodes.vue` (MODIFY)

Same pattern as above — add `error` ref, replace console.error, add template display.

---

### d) Dependencies

- Existing `.error` CSS class already defined in the project

---

### e) Risks/Edge Cases

- **[Race condition]**: Ensure `error` is cleared on retry (set `error.value = null` before each load call)
- **[Loading vs error]**: Don't overwrite loading state — error should display after loading is false

---

### f) Testing

#### Frontend Unit Tests
- [ ] No tests currently exist for these views — new component tests could be added

#### CI Requirements
- [ ] `npm test -- --run` passes
- [ ] `npm run lint` passes

---

### g) Files Changed

**Frontend:**
```
frontend/src/views/ProjectMilestones.vue   → MODIFY
frontend/src/views/ComputeNodes.vue        → MODIFY
```
