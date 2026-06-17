# 02_ARCHITECT_DESIGN.md — Ticket Planning Files with Custom Templates

**Status**: planned
**Date created**: 2026-06-17
**Author**: AI Assistant

---

## Problem Statement

Planning files live in a static `/planning/` directory on disk. They don't travel with tickets. AI agents have no way to read or write planning files as part of their ticket workflow. Users can't define custom planning templates.

---

## Current State

### Planning files (static)
```
planning/
  00_ARCHITECT_CHECKLIST.md
  01_ARCHITECT_REQUIREMENT.md
  02_ARCHITECT_DESIGN.md
  03_ARCHITECT_IMPLEMENTATION.md
```
- Flat markdown files in a git directory
- Not associated with any ticket
- Not accessible via API
- Not editable by agents

### Ticket model
```javascript
// backend/src/models/ticket.js
{
  id, projectId, title, description, status, priority,
  assigneeId, ownerId, createdAt, updatedAt
}
```
- No planning-related fields
- No template reference
- No planning status

### Database
```sql
-- tickets table (001_create_tables.sql)
tickets {
  id, project_id, title, description, status, priority,
  assignee_id, owner_id, created_at, updated_at
}
-- Unused columns (008_ticket_repo_fields.sql)
-- branch_name, pr_url, pr_state — exist but never used
```

### File upload
- Zero file upload support in the entire codebase
- No multer, busboy, FormData usage
- Generated TypeScript client has `isFormData` helpers but no endpoints use them

---

## Design

### Database Schema

```sql
-- Migration 016_ticket_planning.sql (NEW)

-- Planning files: versioned markdown per ticket
CREATE TABLE ticket_planning (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  file_key VARCHAR(100) NOT NULL,        -- '00_ARCHITECT_CHECKLIST', '01_REQUIREMENT', etc.
  content TEXT NOT NULL,                  -- markdown content
  version INTEGER NOT NULL DEFAULT 1,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(ticket_id, file_key, version)
);

CREATE INDEX idx_ticket_planning_ticket_id ON ticket_planning(ticket_id);
CREATE INDEX idx_ticket_planning_file_key ON ticket_planning(ticket_id, file_key);

-- Attachments: binary files per ticket
CREATE TABLE ticket_attachments (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size_bytes INTEGER NOT NULL,
  stored_path TEXT NOT NULL,              -- filesystem path or future S3 key
  uploaded_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);

-- Custom template definitions (project-scoped)
CREATE TABLE project_templates (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  file_definitions JSONB NOT NULL,        -- [{key: '00_CHECKLIST', title: 'Pre-Implementation Checklist', required: true}, ...]
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_project_templates_project_id ON project_templates(project_id);

-- Add columns to tickets table
ALTER TABLE tickets ADD COLUMN planning_status VARCHAR(50) DEFAULT 'not_started'
  CHECK (planning_status IN ('not_started', 'template_selected', 'in_progress', 'review', 'completed'));

ALTER TABLE tickets ADD COLUMN template_schema VARCHAR(100);
-- 'architect' for built-in ARCHITECT templates, or name of a custom template from project_templates
```

### API Endpoints

```
# Planning files (nested under tickets)
GET    /tickets/:id/planning              → list all planning files for ticket
GET    /tickets/:id/planning/:fileKey     → get specific planning file (with version)
PUT    /tickets/:id/planning/:fileKey     → create/update a planning file (increments version)
POST   /tickets/:id/planning/apply-template → apply a template to create initial planning files

# Attachments
GET    /tickets/:id/attachments           → list attachments
POST   /tickets/:id/attachments           → upload attachment (multipart/form-data)
GET    /attachments/:attachmentId         → serve/download attachment
DELETE /tickets/:id/attachments/:attachmentId → delete attachment

# Quick planning access (included in ticket GET)
GET    /tickets/:id                       → now includes `planning` object with all file contents
```

### Response Format

```json
// GET /tickets/:id response
{
  "success": true,
  "data": {
    "id": "abc123",
    "title": "Implement rate limiting on auth endpoints",
    "description": "...",
    "status": "backlog",
    "priority": "high",
    "planning": {
      "status": "in_progress",
      "templateSchema": "architect",
      "files": [
        {
          "fileKey": "00_ARCHITECT_CHECKLIST.md",
          "content": "# 00_ARCHITECT_CHECKLIST.md...\n- [ ] I have read...",
          "version": 3,
          "updatedAt": "2026-06-17T10:30:00Z"
        },
        {
          "fileKey": "01_ARCHITECT_REQUIREMENT.md",
          "content": "# 01_ARCHITECT_REQUIREMENT.md...",
          "version": 1,
          "updatedAt": "2026-06-17T10:25:00Z"
        }
      ]
    },
    "attachments": [
      {
        "id": "att1",
        "filename": "architecture-diagram.png",
        "contentType": "image/png",
        "sizeBytes": 102400,
        "uploadedAt": "2026-06-17T10:20:00Z"
      }
    ]
  }
}
```

### Multer Middleware

```javascript
// backend/src/middleware/multer.js (NEW)
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '../../uploads/tickets');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const ticketId = req.params.ticketId;
    const dir = path.join(uploadDir, String(ticketId));
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'application/pdf', 'text/markdown', 'text/plain',
    'application/zip', 'application/json',
  ];
  if (allowed.includes(file.mimetype)) cb(null, true);
  else cb(new Error('File type not allowed: ' + file.mimetype), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10, // max 10 files per upload
  },
});

module.exports = upload;
```

### Service Layer

```javascript
// backend/src/services/TicketPlanningService.js (NEW)
class TicketPlanningService {
  // List all planning files for a ticket
  async list(ticketId, userId) { ... }

  // Get a specific planning file
  async get(ticketId, fileKey, userId) { ... }

  // Create or update a planning file (increments version)
  async upsert(ticketId, fileKey, content, userId) { ... }

  // Apply a template to create initial planning files
  async applyTemplate(ticketId, templateName, userId) { ... }

  // Update planning status
  async updateStatus(ticketId, status, userId) { ... }

  // Get planning files included in ticket GET response
  async getPlanningForTicket(ticket, userId) { ... }
}

// backend/src/services/TicketAttachmentService.js (NEW)
class TicketAttachmentService {
  async upload(ticketId, file, userId) { ... }
  async list(ticketId, userId) { ... }
  async get(attachmentId, ticketId, userId) { ... }
  async delete(attachmentId, ticketId, userId) { ... }
}

// backend/src/services/TemplateService.js (NEW)
class TemplateService {
  // Built-in ARCHITECT template definitions
  static getArchitectTemplate() {
    return [
      { key: '00_ARCHITECT_CHECKLIST.md', title: 'Pre-Implementation Checklist', required: true },
      { key: '01_ARCHITECT_REQUIREMENT.md', title: 'Requirement', required: true },
      { key: '02_ARCHITECT_DESIGN.md', title: 'Design', required: true },
      { key: '03_ARCHITECT_IMPLEMENTATION.md', title: 'Implementation', required: true },
    ];
  }

  // List custom templates for a project
  async list(projectId, userId) { ... }

  // Create a custom template
  async create(projectId, name, description, fileDefinitions, userId) { ... }

  // Apply a custom template
  async apply(ticketId, templateId, userId) { ... }
}
```

### Architecture

```
User Request (POST /tickets/:id/attachments)
    ↓
[multer middleware] → save file to uploads/tickets/:ticketId/
    ↓
[TicketAttachmentService.upload()] → INSERT into ticket_attachments
    ↓
[Response: attachment metadata]

User Request (GET /tickets/:id)
    ↓
[TicketService.getOne()] → SELECT ticket
    ↓
[TicketPlanningService.getPlanningForTicket()] → SELECT all planning files
    ↓
[TemplateService.getArchitectTemplate()] → load template definitions
    ↓
[Response: ticket + planning.files + attachments]

Agent Request (GET /tickets/:id)
    ↓
[Same flow as user] → agent receives planning.files inline
    ↓
[Agent reads planning files, updates via PUT /tickets/:id/planning/:fileKey]
```

### Alternative Designs Considered

- **Single JSONB column in tickets table** — Chose separate `ticket_planning` table because: versioning is easier (each version is a row), queries are more efficient (can filter by file_key), and the schema is cleaner. Single JSONB column was considered but rejected because: versioning would require storing all versions in an array, making updates and queries more complex.

- **S3 for attachments** — Chose filesystem storage because: no new external dependencies, simpler to implement, and the project is single-instance. S3 was considered for production scalability but rejected because: it requires AWS credentials, adds cost, and the filesystem is sufficient for now with a clear migration path to S3 later.

- **Web-based markdown editor** — Chose simple textarea for initial implementation because: less code, easier to test, and the frontend can be enhanced later. A full markdown editor (like TipTap or Editor.js) was considered but rejected because: it adds significant frontend complexity and dependencies for a first version.

- **Separate API calls for planning** — Chose to include planning in `GET /tickets/:id` response because: agents don't need a separate call, reduces API round-trips, and the planning data is tightly coupled to the ticket. Separate endpoints were considered but rejected because: agents would need to make 2-5 additional API calls just to read planning files.

### Data Flow Diagram

```
User creates ticket with template
    ↓
POST /tickets
    ↓
[TemplateService.applyTemplate()] → INSERT into ticket_planning (one row per file)
    ↓
[UPDATE tickets SET planning_status = 'template_selected', template_schema = 'architect']
    ↓
User fills in planning files
    ↓
PUT /tickets/:id/planning/:fileKey
    ↓
[TicketPlanningService.upsert()] → INSERT new version row into ticket_planning
    ↓
[UPDATE tickets SET planning_status = 'in_progress']

Agent polls for tickets
    ↓
GET /tickets/:id
    ↓
[SELECT ticket + SELECT all ticket_planning rows + SELECT all ticket_attachments rows]
    ↓
[Response: { ticket, planning: { files: [...] }, attachments: [...] }]
    ↓
Agent reads planning files, updates content
    ↓
PUT /tickets/:id/planning/:fileKey
    ↓
Agent posts messages
    ↓
POST /tickets/:id/messages → ticket_messages table
```

### Config / Env Changes

- NEW: `backend/src/middleware/multer.js` — file upload middleware
- NEW: `backend/src/services/TicketPlanningService.js` — planning file CRUD
- NEW: `backend/src/services/TicketAttachmentService.js` — attachment CRUD
- NEW: `backend/src/services/TemplateService.js` — template management
- NEW: `backend/src/controllers/ticketPlanningController.js` — planning endpoints
- NEW: `backend/src/controllers/ticketAttachmentController.js` — attachment endpoints
- NEW: `backend/src/api/ticketPlanning.js` — planning route module
- NEW: `backend/src/api/ticketAttachment.js` — attachment route module
- NEW: `backend/src/migrations/016_ticket_planning.sql` — database migrations
- NEW: `backend/uploads/` — directory for attachment storage (created on first upload)
- CHANGED: `backend/src/models/ticket.js` — add planningStatus, templateSchema to constructor/fromRow
- CHANGED: `backend/src/services/TicketService.js` — include planning in getOne, findByProject
- CHANGED: `backend/src/api/routes.js` — mount planning and attachment routes
- CHANGED: `backend/package.json` — add `multer` dependency
- CHANGED: `frontend/src/views/TicketDetail.vue` — add Planning tab with markdown editor
- CHANGED: `frontend/src/api/client.js` — add FormData support for uploads
- CHANGED: `frontend/src/api/generated/models/Ticket.ts` — add planning and attachments fields

---

## Dependencies

- **Existing**: `ticket_messages` table (activity log), `verifyTokenOrAgent` middleware (agent access)
- **New**: `multer` package (file upload)
- **New**: 3 new service files, 2 new controller files, 2 new route modules
- **New**: 1 migration file with 3 new tables + 2 ALTER TABLE statements

---

## Risks/Edge Cases

- **[File size abuse]**: Users upload 10MB files repeatedly. Mitigation: enforce 10MB limit, add cleanup job for orphaned files.
- **[Disk space]**: Attachments accumulate on disk. Mitigation: add `DELETE /attachments/:id` endpoint, consider periodic cleanup job.
- **[Concurrency]**: Two agents update the same planning file simultaneously. Mitigation: version column prevents overwrites; last write wins (similar to git).
- **[SQL injection]**: Planning file content stored as TEXT. Mitigation: parameterized queries (pg handles this automatically).
- **[XSS in markdown]**: Markdown content rendered in frontend. Mitigation: use a markdown renderer that strips HTML (e.g., `marked` with sanitized output).
- **[Attachment serving]**: Files served from filesystem — need to handle missing files gracefully. Mitigation: check file exists before serving, return 404 if not found.
- **[Soft delete cascade]**: Deleting a ticket should cascade to planning files and attachments. Mitigation: `ON DELETE CASCADE` on foreign keys.
- **[Agent permission]**: Agents should be able to read planning files but may not be able to write them. Mitigation: use `verifyTokenOrAgent` for GET, `verifyToken` for PUT/POST on planning endpoints.

---

*Ready for implementation phase.*
