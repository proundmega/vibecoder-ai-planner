# 03_ARCHITECT_IMPLEMENTATION.md — Custom Templates Feature

**Status**: completed
**Priority**: P2 (Medium)
**Effort**: Medium (~4-6 hours)
**Author**: AI Assistant
**Date created**: 2026-06-24
**Date completed**: 2026-06-25
**PR**: TBD
**Branch**: bp-19-custom-templates

## Implementation Plan

### Phase 1: Backend API

1. **Create `templateController.js`** — CRUD controller with 3 methods:
   - `list(req, res)` — `TemplateService.list(projectId, userId)`
   - `create(req, res)` — validate name/files, check duplicate name, `TemplateService.create()`
   - `delete(req, res)` — `TemplateService.delete()` (need to add this method)

2. **Add routes to `api/v1/index.js`** — 3 routes under `/projects/:projectId/templates`:
   - `GET /projects/:id/templates` → `requireAnyPermission('TICKET_UPDATE')`
   - `POST /projects/:id/templates` → `requireAnyPermission('TICKET_UPDATE')`
   - `DELETE /projects/:id/templates/:id` → `requireAnyPermission('TICKET_UPDATE')`

3. **Add `TemplateService.delete()`** — DELETE from project_templates

4. **Fix `TemplateService.apply()`** — change `throw new Error()` to `throw new NotFoundError()`

5. **Add OpenAPI annotations** — JSDoc in `api/ticketPlanning.js` or new `api/templates.js`

6. **Create `templateController.test.js`** — test list, create, duplicate name rejection, delete

### Phase 2: Frontend API Client

7. **Create `templates.js`** — 3 functions:
   - `listTemplates(projectId)` → GET
   - `createTemplate(projectId, data)` → POST
   - `deleteTemplate(projectId, templateId)` → DELETE

8. **Create `templates.test.js`** — test all 3 functions with mocked client

### Phase 3: Frontend Screen

9. **Create `ProjectTemplates.vue`** — view component:
   - List templates (name, description, file count, created date, delete button)
   - Empty state
   - "Create Template" button → opens modal
   - Create modal: name, description, dynamic file list (key + content rows)

10. **Add route in `router/index.ts`** — child route under `/projects/:id`:
    ```typescript
    { path: 'templates', name: 'ProjectTemplates', component: () => import('../views/ProjectTemplates.vue') }
    ```

11. **Add link in `ProjectDetail.vue`** — "Custom Templates" link (not a tab, a standalone page link)

### Phase 4: Integration with TicketDetail.vue

12. **Fetch custom templates** — call `listTemplates(ticket.projectId)` when template modal opens

13. **Merge into selector** — built-in templates + custom templates with a separator

### Phase 5: Verify

14. `cd backend && npm test` — all pass
15. `cd backend && npm run lint` — zero errors
16. `cd frontend && npm run lint` — zero errors
17. `cd frontend && npm run typecheck` — zero errors
18. `cd frontend && npm test -- --run` — all pass
19. `cd frontend && npm run build` — succeeds

## Rollback Plan

Remove new files and revert route changes. TemplateService methods are already in place, so no DB changes needed.

---

*Ready for implementation.*
