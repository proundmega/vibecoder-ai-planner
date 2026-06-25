# 01_ARCHITECT_REQUIREMENT.md — Custom Templates Feature

**Status**: completed
**Date created**: 2026-06-24

## Requirement

Allow users to create, manage, and use their own custom planning templates within a project. Custom templates appear alongside the built-in templates (architecture, technical, simple) in the ticket template selector.

## Existing Infrastructure Audit

**What exists**:
- `project_templates` table in DB (project-scoped, JSONB file_definitions)
- `TemplateService` has `create()`, `list()`, `apply()` — but no API routes expose them
- `TicketPlanningService._getCustomTemplate()` already resolves custom templates by name
- `POST /tickets/:id/planning/apply-template` already accepts any template name string

**What's missing**:
- No API endpoints for custom template CRUD
- No frontend screen to manage templates
- No integration in the template selector modal

## Scope

**In scope**:
1. Backend API: `GET`, `POST`, `DELETE` for custom templates (project-scoped)
2. Frontend screen: list/create/delete custom templates at `/projects/:id/templates`
3. Integrate custom templates into TicketDetail.vue template selector modal
4. Unit tests for new API and frontend code

**Out of scope**:
- Editing existing custom templates (create/delete only for v1)
- Uploading template files (manual JSON entry for v1)
- Template versioning
- Sharing templates across projects

## Acceptance Criteria

- [ ] API: `GET /api/v1/projects/:id/templates` returns list of custom templates
- [ ] API: `POST /api/v1/projects/:id/templates` creates a custom template
- [ ] API: `DELETE /api/v1/projects/:id/templates/:id` deletes a custom template
- [ ] Frontend: Templates screen at `/projects/:id/templates` shows list + create form
- [ ] Frontend: Custom templates appear in TicketDetail.vue template selector modal
- [ ] Permission: Requires `TICKET_UPDATE` (same as planning edits)
- [ ] All tests pass, lint clean, build succeeds

## Testing Checklist

- [ ] Backend tests for template controller (CRUD operations)
- [ ] Frontend tests for templates API client
- [ ] Lint passes with zero errors
- [ ] Typecheck passes with zero errors
- [ ] All existing tests still pass
- [ ] Build succeeds

## CI Requirements (MANDATORY)

- `cd backend && npm test` — all pass
- `cd backend && npm run lint` — zero errors
- `cd frontend && npm run lint` — zero errors
- `cd frontend && npm run typecheck` — zero errors
- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run build` — succeeds
