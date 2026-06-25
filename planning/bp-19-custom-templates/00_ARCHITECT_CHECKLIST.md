# 00_ARCHITECT_CHECKLIST.md — Custom Templates Feature

**Status**: completed
**Date created**: 2026-06-24

## Pre-Implementation Checklist

### Existing Infrastructure Audit
- [x] `project_templates` table exists (migration 016) with columns: id, project_id, name, description, file_definitions (JSONB), created_by, created_at
- [x] `TemplateService.create()` exists but has no API route — dead code
- [x] `TemplateService.list()` exists but has no API route — dead code
- [x] `TemplateService.apply()` exists but has no API route — dead code
- [x] `TicketPlanningService._getCustomTemplate()` already looks up custom templates by name from project_templates
- [x] `POST /tickets/:id/planning/apply-template` already supports custom template names (falls through to _getCustomTemplate)
- [x] Permission system uses TICKET_UPDATE for template operations (same as planning edits)
- [x] ProjectDetail.vue has tabs — templates screen should be a standalone page with link from ProjectDetail

### Risk Assessment
- Medium risk — new API routes + new frontend view + router changes
- Custom templates are project-scoped via existing `project_templates` table
- No data migration needed — table already exists

### Files to Touch
**Backend**:
1. `backend/src/api/v1/index.js` — add template CRUD routes
2. `backend/src/controllers/templateController.js` — NEW controller
3. `backend/src/services/TemplateService.js` — fix error class in apply(), add delete() method

**Frontend**:
4. `frontend/src/api/templates.js` — NEW API client
5. `frontend/src/views/ProjectTemplates.vue` — NEW view (template management screen at /projects/:id/templates)
6. `frontend/src/router/index.ts` — add templates route under projects/:id
7. `frontend/src/views/ProjectDetail.vue` — add link to templates page
8. `frontend/src/views/TicketDetail.vue` — integrate custom templates into selector modal

**Tests**:
9. `backend/src/__tests__/templateController.test.js` — NEW
10. `frontend/src/__tests__/templates.test.js` — NEW

### Validation Steps
- [ ] `cd backend && npm test` — all pass
- [ ] `cd backend && npm run lint` — zero errors
- [ ] `cd frontend && npm run lint` — zero errors
- [ ] `cd frontend && npm run typecheck` — zero errors
- [ ] `cd frontend && npm test -- --run` — all pass
- [ ] `cd frontend && npm run build` — succeeds

### Rollback
Revert the new files and route changes. TemplateService methods are already in place.

---

*Ready for requirement phase.*
