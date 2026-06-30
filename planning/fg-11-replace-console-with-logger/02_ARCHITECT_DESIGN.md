# 02_ARCHITECT_DESIGN.md — Replace console.error with Winston Logger

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

Frontend components use `console.error()` for handling API failures, which provides no user feedback. The project convention (seen in views like `AgentList.vue`, `ProjectDetail.vue`) is to use a reactive `error` ref that renders an inline error message in the template.

---

## Current State

### Existing Frontend
- `ProjectMilestones.vue` has `console.error('Failed to ...', err)` in catch blocks without error state
- `ComputeNodes.vue` has `console.error('Failed to ...', err)` in catch blocks without error state
- Other views like `AgentList.vue` and `TicketDetail.vue` correctly set `error.value = 'Failed to ...'` in catch blocks and display `<div v-if="error" class="error">{{ error }}</div>`

### Gap Analysis
Some components follow the error state pattern; others use console.error.

---

## Design

### Option A: Add error state refs + template display (Recommended)

Follow the exact pattern from `AgentList.vue`:
```javascript
const error = ref(null)
// ...
catch (err) {
  error.value = 'Failed to load milestones'
}
```
```html
<div v-if="error" class="error">{{ error }}</div>
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `frontend/src/views/ProjectMilestones.vue` | MODIFY | Add `error` ref, set on catch, display in template |
| `frontend/src/views/ComputeNodes.vue` | MODIFY | Add `error` ref, set on catch, display in template |
