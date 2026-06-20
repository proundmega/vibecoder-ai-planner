# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: fg-04 — Fix ticket planning template name mismatch

**Status**: planned | in_progress | completed | blocked
**Priority**: P1
**Effort**: Small
**Author**: AI Assistant
**Date created**: 2026-06-19
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Backend + Frontend

**Dependencies**: None

---

### a) Purpose

Fix the template name mismatch that prevents users from applying planning templates. The frontend offers `['architecture', 'technical', 'simple']` but the backend only accepts `'architect'`.

---

### b) Actions

#### Phase 1: Backend

1. Update `backend/src/api/ticketPlanning.js` — update OpenAPI spec enum:
   ```javascript
   // Line ~102, change:
   // enum: [architect]
   // To:
   // enum: [architecture, technical, simple]
   ```

2. Update `backend/src/controllers/ticketPlanningController.js` — update template mapping:
   ```javascript
   // Find the template mapping object and update it:
   const templates = {
     architecture: {
       // System design template content
       files: {
         'ARCHITECTURE.md': '...'
       }
     },
     technical: {
       // Technical implementation template content
       files: {
         'IMPLEMENTATION.md': '...'
       }
     },
     simple: {
       // Basic task list template content
       files: {
         'TASKS.md': '...'
       }
     }
   };
   ```

3. Search for any references to `'architect'` in the codebase and update them:
   ```bash
   grep -rn "'architect'" backend/src/
   ```

#### Phase 2: Frontend

4. Verify `frontend/src/views/TicketDetail.vue:435` — template options are already correct:
   ```vue
   v-for="template in ['architecture', 'technical', 'simple']"
   ```
   No changes needed if the backend is fixed.

5. Verify template descriptions at lines 441-442 match the new names.

#### Phase 3: Testing

6. Run backend tests: `cd backend && npm test`
7. Run frontend tests: `cd frontend && npm test -- --run`
8. Run frontend lint: `cd frontend && npm run lint`
9. Run frontend typecheck: `cd frontend && npm run typecheck`
10. Manual test: Apply each template in the UI, verify files are created

---

### c) Dependencies

- None

---

### d) Risks/Edge Cases

- **[Risk]**: Existing code references `'architect'` elsewhere
  **[Mitigation]**: grep for all occurrences before changing

---

### e) Testing

#### Backend Unit Tests
- [ ] Test `applyTemplate` with each of the three template names
- [ ] Test invalid template name returns 400

#### Frontend Tests
- [ ] `npm test -- --run` — no regressions

#### CI Requirements
- [ ] `npm test` — backend tests pass
- [ ] `npm run lint` — both pass
- [ ] `npm run typecheck` — frontend passes

---

### f) Migration Notes

Not applicable — no database changes.

---

### g) Files Changed

**Backend:**
```
backend/src/api/ticketPlanning.js          → update OpenAPI spec enum
backend/src/controllers/ticketPlanningController.js → update template mapping
```

**Frontend:**
```
frontend/src/views/TicketDetail.vue        → verify template names (likely no change needed)
```

---

### h) Code Review Checklist

- [ ] Backend accepts `'architecture'`, `'technical'`, `'simple'`
- [ ] OpenAPI spec enum updated
- [ ] Template mapping in controller has all three templates
- [ ] No references to old `'architect'` name remain
- [ ] All tests pass
- [ ] Frontend template names match backend

---

### i) Post-Deploy Verification

1. [ ] `cd backend && npm test` passes
2. [ ] `cd frontend && npm test -- --run` passes
3. [ ] Apply 'architecture' template → files created
4. [ ] Apply 'technical' template → files created
5. [ ] Apply 'simple' template → files created
