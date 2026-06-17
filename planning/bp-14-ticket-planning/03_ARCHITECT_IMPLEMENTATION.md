# 03_ARCHITECT_IMPLEMENTATION.md — Ticket Planning Files with Custom Templates

**Status**: planned
**Priority**: P1 (High)
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-06-17
**Date completed**: TBD
**PR**: TBD
**Branch**: bp-14-ticket-planning

**Dependencies**: None

---

### a) Purpose

Add planning files to tickets so users can fill in ARCHITECT templates (or custom templates) and AI agents can read/write planning files as part of the ticket workflow. Planning files are stored per-ticket, versioned, and included in the ticket GET response.

**Value delivered**: Planning files travel with tickets. Agents have full context when working on tickets. Users can define custom planning workflows.

---

### b) Actions

#### Phase 1: Database Migration

1. **Create migration** — `backend/src/migrations/016_ticket_planning.sql`
   - Create `ticket_planning` table (versioned markdown files)
   - Create `ticket_attachments` table (binary files)
   - Create `project_templates` table (custom template definitions)
   - ALTER TABLE `tickets` add `planning_status` and `template_schema` columns
   - Add indexes on all new tables

#### Phase 2: Backend Services

2. **Create multer middleware** — `backend/src/middleware/multer.js`
   - `multer.diskStorage` with ticket-specific directory
   - File type filter (images, PDF, markdown, JSON, ZIP)
   - 10MB file size limit
   - Auto-create upload directories

3. **Create TicketPlanningService** — `backend/src/services/TicketPlanningService.js`
   - `list(ticketId, userId)` — SELECT all planning files for ticket
   - `get(ticketId, fileKey, userId)` — SELECT specific planning file
   - `upsert(ticketId, fileKey, content, userId)` — INSERT new version or UPDATE latest
   - `applyTemplate(ticketId, templateName, userId)` — INSERT initial planning files from template
   - `updateStatus(ticketId, status, userId)` — UPDATE tickets.planning_status
   - `getPlanningForTicket(ticket, userId)` — SELECT all planning files, format for response

4. **Create TicketAttachmentService** — `backend/src/services/TicketAttachmentService.js`
   - `upload(ticketId, file, userId)` — save file, INSERT into ticket_attachments
   - `list(ticketId, userId)` — SELECT all attachments for ticket
   - `get(attachmentId, ticketId, userId)` — SELECT attachment metadata, verify ownership
   - `delete(attachmentId, ticketId, userId)` — DELETE row, remove file from disk

5. **Create TemplateService** — `backend/src/services/TemplateService.js`
   - `getArchitectTemplate()` — static method returning ARCHITECT file definitions
   - `list(projectId, userId)` — SELECT custom templates for project
   - `create(projectId, name, description, fileDefinitions, userId)` — INSERT template
   - `apply(ticketId, templateId, userId)` — INSERT planning files from template

#### Phase 3: Backend Controllers & Routes

6. **Create TicketPlanningController** — `backend/src/controllers/ticketPlanningController.js`
   - `list(req, res)` — GET /tickets/:id/planning
   - `get(req, res)` — GET /tickets/:id/planning/:fileKey
   - `upsert(req, res)` — PUT /tickets/:id/planning/:fileKey
   - `applyTemplate(req, res)` — POST /tickets/:id/planning/apply-template
   - `updateStatus(req, res)` — PATCH /tickets/:id/planning/status

7. **Create TicketAttachmentController** — `backend/src/controllers/ticketAttachmentController.js`
   - `upload(req, res)` — POST /tickets/:id/attachments (uses multer)
   - `list(req, res)` — GET /tickets/:id/attachments
   - `get(req, res)` — GET /attachments/:attachmentId (serve file)
   - `delete(req, res)` — DELETE /tickets/:id/attachments/:attachmentId

8. **Create route modules**
   - `backend/src/api/ticketPlanning.js` — planning routes
   - `backend/src/api/ticketAttachment.js` — attachment routes

9. **Update main routes** — `backend/src/api/routes.js`
   - Mount planning routes under `/tickets/:ticketId/planning`
   - Mount attachment routes under `/tickets/:ticketId/attachments`
   - Mount file serve route under `/attachments/:attachmentId`

#### Phase 4: Model & Service Updates

10. **Update Ticket model** — `backend/src/models/ticket.js`
    - Add `planningStatus`, `templateSchema` to constructor
    - Add `planningStatus`, `templateSchema` to `fromRow()` mapping
    - Update `findById()` to include planning_status and template_schema

11. **Update TicketService** — `backend/src/services/TicketService.js`
    - `getOne()` — include planning files in response
    - `findByProject()` — include planning status in response
    - `create()` — set planning_status = 'not_started', template_schema = null

12. **Update ticket validators** — `backend/src/validators/tickets.js`
    - Add `planningStatus` to update schema
    - Add `templateSchema` to create schema

13. **Update route files** — `backend/src/api/tickets.js`
    - Add planning and attachment route imports
    - Apply `verifyTokenOrAgent` to planning GET endpoints
    - Apply `verifyToken` to planning PUT/POST endpoints (agents can read, not write)

#### Phase 5: Frontend

14. **Update API client** — `frontend/src/api/client.js`
    - Add `uploadAttachment(ticketId, file)` — FormData POST
    - Add `getPlanningFiles(ticketId)` — GET /tickets/:id/planning
    - Add `updatePlanningFile(ticketId, fileKey, content)` — PUT /tickets/:id/planning/:fileKey
    - Add `applyTemplate(ticketId, templateName)` — POST /tickets/:id/planning/apply-template

15. **Update TicketDetail.vue** — `frontend/src/views/TicketDetail.vue`
    - Add "Planning" tab with markdown editor
    - Show template selector dropdown
    - Show file list with status indicators
    - Show version history sidebar
    - Add "Apply Template" button
    - Add "Download All" button (zips planning files)

16. **Update generated TypeScript types** — `frontend/src/api/generated/models/Ticket.ts`
    - Add `planning` object with `status`, `templateSchema`, `files` array
    - Add `attachments` array with `id`, `filename`, `contentType`, `sizeBytes`, `uploadedAt`
    - Run `npm run generate:api` after backend changes

#### Phase 6: Tests

17. **Create backend tests**
    - `backend/src/__tests__/ticketPlanning.test.js` — planning CRUD tests
    - `backend/src/__tests__/ticketAttachment.test.js` — attachment upload/download tests
    - `backend/src/__tests__/templateService.test.js` — template application tests
    - `backend/src/__tests__/multerMiddleware.test.js` — file upload validation tests

18. **Create frontend tests**
    - `frontend/src/__tests__/ticketPlanning.test.js` — planning tab tests
    - `frontend/src/__tests__/ticketAttachment.test.js` — attachment upload tests

---

### c) Dependencies

- **None** — self-contained change
- **New dependency**: `multer` package (lightweight file upload middleware)

---

### d) Risks/Edge Cases

- **[File size abuse]**: Users upload 10MB files repeatedly. Mitigation: enforce 10MB limit, add cleanup job for orphaned files.
- **[Disk space]**: Attachments accumulate on disk. Mitigation: add DELETE endpoint, consider periodic cleanup job.
- **[Concurrency]**: Two agents update the same planning file simultaneously. Mitigation: version column prevents overwrites; last write wins.
- **[XSS in markdown]**: Markdown content rendered in frontend. Mitigation: use sanitized markdown renderer.
- **[Attachment serving]**: Files served from filesystem — need to handle missing files gracefully. Mitigation: check file exists before serving, return 404 if not found.

---

### e) Testing

#### Unit Tests

**TicketPlanningService**
- [ ] `list()` returns all planning files for a ticket
- [ ] `get()` returns specific planning file
- [ ] `upsert()` creates new version on update
- [ ] `applyTemplate()` creates initial planning files from template
- [ ] `updateStatus()` updates planning_status on ticket
- [ ] `getPlanningForTicket()` includes all files in response

**TicketAttachmentService**
- [ ] `upload()` saves file and creates database record
- [ ] `list()` returns all attachments for a ticket
- [ ] `get()` returns attachment metadata, verifies ownership
- [ ] `delete()` removes file from disk and database record

**TemplateService**
- [ ] `getArchitectTemplate()` returns correct file definitions
- [ ] `list()` returns custom templates for a project
- [ ] `create()` creates a custom template
- [ ] `apply()` creates planning files from custom template

**Multer Middleware**
- [ ] Accepts allowed file types (images, PDF, markdown, JSON)
- [ ] Rejects disallowed file types with 400 error
- [ ] Enforces 10MB file size limit
- [ ] Creates upload directory if it doesn't exist

#### Integration Tests

- [ ] POST /tickets/:id/attachments uploads file successfully
- [ ] GET /tickets/:id/attachments lists uploaded files
- [ ] GET /attachments/:id serves the file
- [ ] DELETE /tickets/:id/attachments/:id removes file
- [ ] PUT /tickets/:id/planning/:fileKey creates/updates planning file
- [ ] GET /tickets/:id/planning lists all planning files
- [ ] POST /tickets/:id/planning/apply-template creates initial planning files
- [ ] GET /tickets/:id includes planning object in response
- [ ] Soft delete cascades to planning files and attachments
- [ ] Agents can read planning files (GET) but not write (PUT/POST)

#### Frontend Tests

- [ ] Planning tab renders with file list
- [ ] Markdown editor saves planning file content
- [ ] Template selector applies template correctly
- [ ] Attachment upload shows progress and success
- [ ] Attachment download works correctly

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: Migration adds tables/columns. Run rollback migration to drop tables and remove columns.
- **Downtime**: Migration adds tables (fast, <1s). No data migration needed.
- **Rollback migration**:
```sql
-- 016_ticket_planning_rollback.sql
ALTER TABLE tickets DROP COLUMN IF EXISTS planning_status;
ALTER TABLE tickets DROP COLUMN IF EXISTS template_schema;
DROP TABLE IF EXISTS ticket_planning;
DROP TABLE IF EXISTS ticket_attachments;
DROP TABLE IF EXISTS project_templates;
```
- **Verification after rollback**: Run `npm test` to confirm tests pass. Verify `GET /tickets/:id` no longer includes planning object.

---

### g) Files Changed

**NEW files:**
- `backend/src/migrations/016_ticket_planning.sql`
- `backend/src/middleware/multer.js`
- `backend/src/services/TicketPlanningService.js`
- `backend/src/services/TicketAttachmentService.js`
- `backend/src/services/TemplateService.js`
- `backend/src/controllers/ticketPlanningController.js`
- `backend/src/controllers/ticketAttachmentController.js`
- `backend/src/api/ticketPlanning.js`
- `backend/src/api/ticketAttachment.js`
- `backend/src/__tests__/ticketPlanning.test.js`
- `backend/src/__tests__/ticketAttachment.test.js`
- `backend/src/__tests__/templateService.test.js`
- `backend/src/__tests__/multerMiddleware.test.js`
- `frontend/src/__tests__/ticketPlanning.test.js`
- `frontend/src/__tests__/ticketAttachment.test.js`

**CHANGED files:**
- `backend/package.json` — add `multer` dependency
- `backend/src/models/ticket.js` — add planningStatus, templateSchema
- `backend/src/services/TicketService.js` — include planning in getOne, findByProject
- `backend/src/api/routes.js` — mount planning and attachment routes
- `backend/src/api/tickets.js` — add planning/attachment route imports
- `backend/src/validators/tickets.js` — add planningStatus, templateSchema
- `frontend/src/api/client.js` — add uploadAttachment, getPlanningFiles, updatePlanningFile, applyTemplate
- `frontend/src/views/TicketDetail.vue` — add Planning tab
- `frontend/src/api/generated/models/Ticket.ts` — add planning and attachments fields (regenerated)

---

### h) Code Review Checklist

- [ ] Migration is idempotent (can be run multiple times without error)
- [ ] All foreign keys have `ON DELETE CASCADE`
- [ ] File upload middleware validates file type and size
- [ ] Planning file upsert increments version correctly
- [ ] Attachment delete removes both database record and file from disk
- [ ] Agents can read planning files but not write them (verifyToken vs verifyTokenOrAgent)
- [ ] Planning files are included in ticket GET response
- [ ] Custom templates are project-scoped (not global)
- [ ] Soft delete cascades to planning files and attachments
- [ ] Multer middleware creates upload directories automatically
- [ ] Markdown renderer sanitizes HTML output (XSS prevention)
- [ ] All new endpoints have proper error handling (404, 403, 400)
- [ ] File size limit is enforced at multer level AND service level (defense in depth)

---

### i) Post-Deploy Verification

- [ ] `GET /tickets/:id` includes `planning` object with `files` array
- [ ] `POST /tickets/:id/planning/apply-template` creates initial planning files
- [ ] `PUT /tickets/:id/planning/:fileKey` creates new version
- [ ] `POST /tickets/:id/attachments` uploads file successfully
- [ ] `GET /attachments/:id` serves the uploaded file
- [ ] `DELETE /tickets/:id/attachments/:id` removes file from disk and database
- [ ] Frontend Planning tab renders correctly
- [ ] Template selector shows ARCHITECT and custom templates
- [ ] Markdown editor saves planning file content
- [ ] Agents receive planning files in ticket GET response
- [ ] Monitor disk usage for 15 minutes — no unexpected growth
- [ ] Check error logs for multer upload failures

---

### j) Migration Notes

- Migration 016 adds 3 new tables and 2 columns to `tickets`
- No data migration needed — existing tickets have `planning_status = 'not_started'`
- Rollback migration drops tables and removes columns
- Upload directory `backend/uploads/` is created on first file upload (not in git)
- Add `backend/uploads/` to `.gitignore`

---

### k) Notes

- Planning files stored in PostgreSQL TEXT (small, <10KB)
- Attachments stored on filesystem (larger, binary files)
- Version column in `ticket_planning` enables change history
- `planning` object included in ticket GET response (no separate API call needed)
- Agents read planning files inline; users write via frontend
- Custom templates defined in `project_templates` table with JSONB file definitions
- ARCHITECT template is built-in (static method in TemplateService)
- Multer middleware handles file validation, size limits, and directory creation

---

*This ticket follows the 4 ARCHITECT templates:*
- *`00_ARCHITECT_CHECKLIST.md` → Pre/post-implementation checklist, when to ask the user*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirement, scope, assumptions, important design decisions, acceptance criteria, out of scope, testing checklist, CI requirements, anti-patterns*
- *`02_ARCHITECT_DESIGN.md` → Problem statement, current state, design with code, alternative designs considered, data flow diagram, dependencies, config/env changes, risks/edge cases*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing, rollback plan, files changed, code review checklist, post-deploy verification, migration notes, notes*
