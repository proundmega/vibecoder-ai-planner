# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Frontend + Backend
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

The Ticket Planning section offers three templates (`architecture`, `technical`, `simple`) but the backend only recognizes `'architect'`. When a user selects a template, the backend returns a 400 error because the template name is not in the allowed list.

---

## Current State

### Existing Backend
- **Route**: `POST /api/v1/tickets/:ticketId/planning/apply-template` — inlined in `v1/index.js:43`
- **Controller**: `ticketPlanningController.applyTemplate()` — checks template name against allowed list
- **OpenAPI spec** at `ticketPlanning.js:102`: `enum: [architect]` — only one template name defined
- **Template mapping**: Controller maps template name → file content (currently only `'architect'`)

### Existing Frontend
- **API Client**: `frontend/src/api/ticketPlanning.js` — calls `POST /tickets/:ticketId/planning/apply-template`
- **UI**: `frontend/src/views/TicketDetail.vue:435` — template options: `['architecture', 'technical', 'simple']`
- **UI**: `frontend/src/views/TicketDetail.vue:441-442` — template descriptions for each option

### Gap Analysis
- Backend only accepts `'architect'` (singular, abbreviated)
- Frontend offers `'architecture'`, `'technical'`, `'simple'` (descriptive, plural-consistent)
- Template names don't match → 400 error on apply

---

## Design

### Option A: Fix Backend to Accept Frontend Names (Recommended)

**Changes in `backend/src/api/ticketPlanning.js` and `backend/src/controllers/ticketPlanningController.js`:**

1. Update the OpenAPI spec enum:
   ```javascript
   // Before:
   // enum: [architect]
   
   // After:
   // enum: [architecture, technical, simple]
   ```

2. Update the controller's template mapping:
   ```javascript
   // Before:
   const templates = {
     architect: { /* content */ }
   };
   
   // After:
   const templates = {
     architecture: { /* system design content */ },
     technical: { /* implementation steps content */ },
     simple: { /* basic task list content */ }
   };
   ```

**Why this is the right choice**: The frontend names are more descriptive and user-friendly. The backend should adapt to the consumer's expectations.

### Option B: Fix Frontend to Match Backend

Change the frontend options to `['architect']`.

**Pros**: Minimal backend changes.
**Cons**: Loses the three template options. Users can't choose between architecture, technical, or simple planning.
**Decision**: Option A is better — the frontend's design is more user-friendly.

### Option C: Accept Both Sets of Names

Accept both `'architect'` and `'architecture'` (and map them to the same content).

**Pros**: Backward compatible.
**Cons**: Unnecessary complexity. There are no other callers besides the frontend.
**Decision**: Option A is cleaner.

---

## Data Flow Diagram

```
[User selects template] → [Frontend sends { templateName: 'architecture' }]
  → [Backend controller checks templates['architecture']]
  → [Controller generates planning files from template content]
  → [Files saved to planning_files table]
  → [Frontend shows planning section with new files]
```

---

## Dependencies

### Backend Dependencies
- `backend/src/controllers/ticketPlanningController.js` — update template mapping
- `backend/src/api/ticketPlanning.js` — update OpenAPI spec enum

### Frontend Dependencies
- `frontend/src/views/TicketDetail.vue` — may need no change (template names already correct)

### Cross-Cutting Dependencies
- OpenAPI spec regeneration: `cd frontend && npm run generate:spec && npm run generate:api`

---

## Config / Environment Changes

- No env var changes
- No database migrations
- No npm dependency changes

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: Existing code might reference `'architect'` elsewhere
  **[Mitigation]**: Search for all references to `'architect'` in the codebase before changing

### Frontend Risks
- None

### Integration Risks
- None

### Edge Cases
- `'architect'` was the only valid name — if any external tools use it, they'll need to update (unlikely, only frontend uses this API)

---

## Alternative Designs Considered

### Alternative 1: Fix frontend to match backend
- **Pros**: Minimal backend changes
- **Cons**: Loses template variety, less user-friendly
- **Decision**: Option A is better

### Alternative 2: Accept both name sets
- **Pros**: Backward compatible
- **Cons**: Unnecessary complexity, no other callers
- **Decision**: Option A is cleaner

---

*This design document guides implementation. The fix is updating the backend's template names and OpenAPI spec to match the frontend's three options.*
