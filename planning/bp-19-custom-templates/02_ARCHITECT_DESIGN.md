# 02_ARCHITECT_DESIGN.md — Custom Templates Feature

**Status**: planned
**Date created**: 2026-06-24

## Problem

Users can't create their own planning templates. The template selector in TicketDetail.vue only shows 3 hardcoded built-in templates. Custom templates exist in the DB (`project_templates`) but have no API or UI.

## Current State

### DB Schema (migration 016)
```sql
CREATE TABLE project_templates (
  id BIGSERIAL PRIMARY KEY,
  project_id BIGINT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  file_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
```

### TemplateService (dead code)
```javascript
// These exist but have no API routes
static async list(projectId, userId)   // SELECT from project_templates
static async create(projectId, name, description, fileDefinitions, userId)
static async apply(ticketId, templateId, userId)  // also has bug: uses plain Error instead of NotFoundError
```

### TicketPlanningService._getCustomTemplate()
```javascript
// Already works — looks up by name within project
SELECT * FROM project_templates WHERE project_id = $1 AND name = $2
```

### TicketDetail.vue template selector (hardcoded)
```javascript
v-for="template in ['architecture', 'technical', 'simple']"
```

## Design

### API Design

Three endpoints under `/api/v1/projects/:projectId/templates`:

| Method | Path | Description | Permission |
|--------|------|-------------|------------|
| GET | `/api/v1/projects/:id/templates` | List custom templates | TICKET_UPDATE |
| POST | `/api/v1/projects/:id/templates` | Create template | TICKET_UPDATE |
| DELETE | `/api/v1/projects/:id/templates/:id` | Delete template | TICKET_UPDATE |

**Request/Response shapes**:

GET response:
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "name": "My Custom Template",
      "description": "Our standard architecture review",
      "file_count": 3,
      "created_by_name": "John Doe",
      "created_at": "2026-06-24T..."
    }
  ]
}
```

POST request body:
```json
{
  "name": "My Custom Template",
  "description": "Optional description",
  "files": [
    { "key": "planning.md", "content": "# Planning\n..." },
    { "key": "design.md", "content": "# Design\n..." }
  ]
}
```

POST response:
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "My Custom Template",
    "description": "Optional description",
    "file_count": 2,
    "created_at": "2026-06-24T..."
  }
}
```

DELETE response:
```json
{ "success": true, "data": null }
```

### Template Name Uniqueness

The `_getCustomTemplate()` method looks up by `name`, so names must be unique per project. The POST endpoint should check for duplicate names and return 409 Conflict.

### Frontend Screen

**Route**: `/projects/:id/templates` (child of ProjectDetail)

**View**: `ProjectTemplates.vue` — follows the same pattern as other project sub-pages (GitHub, Providers, Usage, Memory tabs in ProjectDetail.vue).

**Layout**:
- Page header: "Custom Templates"
- "Create Template" button (top-right)
- List of templates (name, description, file count, created date, delete button)
- Empty state: "No custom templates yet. Create one to use in ticket planning."

**Create Modal**:
- Name input (required, unique per project)
- Description textarea (optional)
- Files section: dynamic list of {key, content} pairs
  - "Add File" button adds a new {key, content} row
  - Each row has key input (filename like `planning.md`) and content textarea
  - Delete button per row
- Save / Cancel buttons

**Integration with TicketDetail.vue**:
- Fetch custom templates on mount (or lazy-load when modal opens)
- Merge built-in templates + custom templates in selector
- Built-in templates keep their existing display (with descriptions)
- Custom templates show as: name + description (or "No description")
- Distinguish built-in vs custom with a badge or icon

### Template Format

Custom templates use a simple JSON format in the POST body:
```json
{
  "name": "Template Name",
  "description": "Optional",
  "files": [
    { "key": "filename.md", "content": "markdown content" }
  ]
}
```

The `files` array is stored as `file_definitions` JSONB in the DB. The `key` must end in `.md` (all planning files are markdown).

### Permission Model

Uses `TICKET_UPDATE` permission — same as planning edits and ticket updates. This means:
- `user` role: can manage templates for their own tickets
- `member` role: can manage all templates in the project
- `project_admin` / `super_admin`: full access

### Data Flow

```
User creates template → POST /projects/:id/templates → TemplateService.create() → INSERT into project_templates
User applies template → POST /tickets/:id/planning/apply-template → TicketPlanningService.applyTemplate() → _getCustomTemplate() → SELECT from project_templates → INSERT into ticket_planning
```

### Bug Fix in TemplateService.apply()

Line 480 uses `throw new Error('Template not found')` instead of `throw new NotFoundError(...)`. This causes a 500 error. Fix to use `NotFoundError` for a proper 404 response.

## Risk Assessment

- **Medium risk** — new files, new routes, new UI
- Custom templates are project-scoped (safe)
- No data migration needed
- TemplateService methods already exist (just need wiring)

---

*Ready for implementation phase.*
