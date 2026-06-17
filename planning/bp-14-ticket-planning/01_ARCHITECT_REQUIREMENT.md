# 01_ARCHITECT_REQUIREMENT.md — Ticket Planning Files with Custom Templates

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Requirement

Tickets must carry their own planning files (ARCHITECT templates or custom templates) that users fill in and AI agents read/write as part of the ticket workflow. Planning files are stored per-ticket, versioned, and included in the ticket GET response so agents have full context.

---

## Scope

- Create `ticket_planning` table (versioned markdown files per ticket)
- Create `ticket_attachments` table (binary files per ticket)
- Create `project_templates` table (custom template definitions)
- Add `planning_status` and `template_schema` columns to `tickets` table
- Add planning endpoints under `/tickets/:id/planning/*`
- Add attachment upload/download endpoints under `/tickets/:id/attachments/*`
- Include `planning` object in `GET /tickets/:id` response
- Add multer middleware for file uploads
- Update frontend TicketDetail with Planning tab
- Agents receive planning files inline with ticket data

---

## Assumptions

- Planning markdown files are small (<10KB each) and should be stored in PostgreSQL TEXT columns for queryability and transactional safety
- Binary attachments (images, PDFs, diagrams) should be stored on the filesystem with optional S3 fallback in the future
- The `ticket_messages` table already exists and will serve as the activity log for planning changes
- Agents already have a polling loop that calls `GET /tickets/:id` — the response format change will be picked up automatically
- Custom templates are project-scoped, not global — each project can define its own planning workflow
- File upload uses `multer` package (no existing upload infrastructure)
- The existing `branch_name`, `pr_url`, `pr_state` columns in the tickets table are unused and can be repurposed or left as-is

---

## Important Design Decisions

**These decisions MUST be confirmed by the user before implementation. Do NOT proceed without answers.**

1. **Where should binary attachments be stored?**
   - Filesystem (`uploads/tickets/:ticketId/`) — simple, no external dependency, survives restarts if volume is mounted
   - S3/compatible object storage — scalable, survives container restarts, requires AWS credentials
   - PostgreSQL `BYTEA` — keeps everything in DB, but bloats the database and makes serving files slower

2. **Should planning files be editable by agents?**
   - Yes — agents fill in content as they work (e.g., agent updates `02_ARCHITECT_DESIGN.md` with implementation details)
   - No — agents only read planning files; humans fill them in

3. **Should the frontend include a markdown editor?**
   - Yes — a simple textarea with markdown preview (like GitHub's editor)
   - No — plain textarea, no preview. Simpler, less code

4. **Should custom templates be user-defined via UI or code-only?**
   - UI — users define templates through a form in the frontend
   - Code-only — templates defined in `project_templates` table via API calls (faster to implement)

---

## Acceptance Criteria

- [ ] `ticket_planning` table created with versioned markdown files per ticket
- [ ] `ticket_attachments` table created with binary file storage
- [ ] `project_templates` table created with JSONB file definitions
- [ ] `tickets` table has `planning_status` and `template_schema` columns
- [ ] `GET /tickets/:id` returns `planning` object with all file contents inline
- [ ] `GET /tickets/:id/planning` lists all planning files for a ticket
- [ ] `PUT /tickets/:id/planning/:fileKey` creates or updates a planning file (increments version)
- [ ] `POST /tickets/:id/planning/apply-template` applies a template and creates initial planning files
- [ ] `POST /tickets/:id/attachments` uploads a binary attachment (multipart/form-data)
- [ ] `GET /tickets/:id/attachments` lists all attachments for a ticket
- [ ] `GET /attachments/:id` serves/download an attachment file
- [ ] `DELETE /tickets/:id/attachments/:id` removes an attachment
- [ ] Planning files are versioned — each update creates a new version row
- [ ] Agents receive planning files in the ticket GET response (no separate call needed)
- [ ] Custom templates can be applied to create initial planning files
- [ ] All unit tests pass (`npm test`)
- [ ] All integration tests pass (`npm run test:integration`)
- [ ] Linting passes with no errors (`npm run lint`)

---

## Out of Scope

- S3 integration (filesystem only for now — S3 can be added later)
- Real-time collaboration on planning files (no WebSocket needed)
- Planning file diff/viewer (version history is just a list, no inline diff)
- Planning file export as PDF (ZIP download is enough)
- AI-assisted planning file generation (agents fill in manually)
- Planning file comments/reviews (comments already exist on tickets)
- Template marketplace or sharing between projects (templates are project-scoped)
- Drag-and-drop upload UI (button-based upload is sufficient)

---

## Testing Checklist

- [ ] `ticket_planning` table created with correct schema
- [ ] `ticket_attachments` table created with correct schema
- [ ] `project_templates` table created with correct schema
- [ ] `planning_status` and `template_schema` columns added to `tickets`
- [ ] Planning files are stored and retrieved correctly
- [ ] Planning file versions increment on update
- [ ] Attachments are uploaded, served, and deleted correctly
- [ ] Custom templates can be applied to create planning files
- [ ] `GET /tickets/:id` includes `planning` object
- [ ] Agents receive planning files inline (no separate call needed)
- [ ] File type validation works for uploads
- [ ] File size limit enforced (10MB)
- [ ] Soft delete cascades to planning files and attachments
- [ ] Unit tests pass for all new endpoints
- [ ] Integration tests pass for all new endpoints
- [ ] Linting passes with no errors

---

## CI Requirements (MANDATORY)

- `npm test` — backend unit tests must pass
- `npm run lint` — no errors
- `npm run db:migrate` — migrations apply without errors

---

## Anti-Patterns to Avoid

- ❌ Storing all planning files in a single JSONB column (hard to query, hard to version)
- ❌ Using `BYTEA` for attachments (blobs DB, makes backups slow)
- ❌ Forgetting to cascade deletes (orphaned planning files/attachments)
- ❌ Not including planning in ticket GET response (agents would need separate calls)
- ❌ Hardcoding template file names (custom templates need dynamic file structures)
- ❌ Skipping file type validation on uploads (security risk)

---

*Ready for design phase.*
