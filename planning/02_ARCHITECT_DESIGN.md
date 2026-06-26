# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: {{Frontend | Backend | Both}}
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

[What problem does this feature solve? Why is it needed now?]

---

## Current State

### Existing Backend
- [What backend code already exists, if anything]
- [API endpoints: `METHOD /path` — what they return]
- [Routes mounted in: `backend/src/api/routes.js` or `backend/src/api/v1/index.js`]
- [Controllers: `backend/src/controllers/`]
- [Services: `backend/src/services/`]
- [Models: `backend/src/models/`]

### Existing Frontend
- [What frontend code already exists, if anything]
- [API clients: `frontend/src/api/`]
- [Views: `frontend/src/views/`]
- [Components: `frontend/src/components/`]
- [Routes: `frontend/src/router/index.ts`]
- [Existing tabs/sections where this feature could fit]

### Gap Analysis
- [What exists vs. what is needed]
- [Backend API exists but no frontend UI]
- [Frontend UI exists but no backend API]
- [Neither exists]
- [Partial overlap — some endpoints covered, others not]

---

## Design

### Option A: Extend Existing Structure (Recommended)

[Describe how to add to what already exists. This is the preferred approach.]

**Example for frontend-only feature (backend API exists):**
```
Add a new tab to ProjectDetail.vue:
  frontend/src/views/ProjectDetail.vue
    → Add "GitHub" tab to existing tabs array
    → Add GitHub panel with connect form, branch list, PR list
    → Follow existing tab styling and panel structure

Add API client:
  frontend/src/api/github.js
    → Import { get, post, put, del } from './client'
    → Create functions matching backend route patterns
    → Follow naming: getRepoStatus, connectRepo, listBranches, etc.
```

**Example for backend-first feature (no API exists):**
```
Create backend API:
  backend/src/api/github.js          → Express router with routes
  backend/src/controllers/githubController.js → Request/response handlers
  backend/src/services/GitHubService.js  → Business logic
  backend/src/validators/github.js   → Joi validation schemas

Mount route in:
  backend/src/api/v1/index.js        → router.use('/github', githubRouter)

Create frontend API client:
  frontend/src/api/github.js         → API wrapper functions

Create frontend UI:
  frontend/src/views/ProjectDetail.vue → New "GitHub" tab
```

**Example for extending existing UI:**
```
If ProjectDetail.vue already has tabs (Tickets, AI Assistant):
  Add new tab "GitHub" to the tabs array
  Add a new panel div inside <div class="tab-content">
  Follow the existing pattern: v-if="activeTab === 'github'"
  Use existing CSS classes: .tab-panel, .panel, .btn-primary

If a modal already exists (TicketEditModal):
  Add new fields to the existing modal
  Don't create a new modal component
```

### Option B: Create New Page

[When to create a new page vs. extending existing. Only use if extending would be worse.]

**Use a new page when:**
- The feature is complex enough to warrant its own route
- The feature has many sub-features that don't fit in a tab
- The feature needs its own navigation entry

**Example:**
```
Create new route:
  frontend/src/router/index.ts → { path: '/projects/:id/integrations', name: 'ProjectIntegrations' }

Create new view:
  frontend/src/views/ProjectIntegrations.vue

Add navigation link:
  frontend/src/views/ProjectList.vue → "Integrations" button on project card
```

### Option C: Add to Existing View (Inline)

[When to add inline to an existing view rather than a tab or new page.]

**Use inline when:**
- The feature is small (1-2 components)
- The feature is closely related to an existing view's purpose
- Adding a tab would be overkill

**Example:**
```
Add GitHub branch info to TicketDetail.vue:
  frontend/src/views/TicketDetail.vue
    → Add "GitHub" section below comments
    → Show branch name, PR link if connected
    → Follow existing section pattern: <div class="github-section">
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/...` | CREATE / MODIFY / NONE | What specifically changes (new method, new endpoint, new import) |
| `frontend/src/...` | CREATE / MODIFY / NONE | What specifically changes (new component, new API call, new tab) |
| `frontend/src/router/...` | MODIFY / NONE | New route if new page |
| Migration `NNN_*.sql` | CREATE / NONE | What the migration does |

---

## Data Flow Diagram

```
[User] → [Frontend UI] → [API Client] → [Backend Route] → [Controller] → [Service] → [Database]
   ↑          ↓              ↓               ↓              ↓            ↓            ↓
[Response] ← [Error handling] ← [Auth] ← [Validation] ← [Business logic] ← [SQL queries]
```

### Frontend Data Flow
1. User interacts with UI component
2. Component calls API client function
3. API client sends HTTP request with auth token
4. Response is parsed and state is updated
5. UI re-renders with new state

### Backend Data Flow
1. HTTP request arrives at route
2. Middleware validates auth (verifyToken)
3. Middleware validates permissions (requireAnyPermission)
4. Middleware validates input (validate schema)
5. Controller parses request, calls service
6. Service executes business logic
7. Service queries database via models
8. Response sent back to frontend

### Error Handling Strategy

**Per-layer error handling:**

| Layer | Error Type | Response |
|-------|-----------|----------|
| Auth middleware | Missing/invalid token | 401, `{ error: "Missing authentication token" }` |
| Permissions middleware | Insufficient role | 403, `{ error: "Forbidden", required: [...], actualRole: "..." }` |
| Validation middleware | Invalid input | 400, `{ error: "Validation failed", details: [...] }` |
| Controller | Business logic error | 400/404/409, `{ error: "descriptive message" }` |
| Service | Unexpected error | Pass to `next(error)`, caught by error handler |
| Error handler (global) | Unhandled error | 500, `{ error: "Internal server error" }` |

---

## Dependencies

### Backend Dependencies
- [Existing backend services/modules this depends on]
- [Database tables/columns this needs]
- [External APIs this calls]
- [Environment variables this needs]

### Frontend Dependencies
- [Existing frontend API clients this uses]
- [Existing UI patterns this extends]
- [Existing routes/navigation this integrates with]
- [Auth store dependencies]

### Cross-Cutting Dependencies
- [OpenAPI spec updates needed]
- [Generated TypeScript types regeneration]
- [Shared configuration]

---

## Config / Environment Changes

- [ ] New environment variables: {{list if any}}
- [ ] New database migrations: {{list if any}}
- [ ] New npm dependencies: {{list if any}}
- [ ] Existing config changes: {{list if any}}

---

## Database Changes

### New Tables
```sql
-- Table schemas if any
```

### New Columns
```sql
-- ALTER TABLE statements if any
```

### Indexes
```sql
-- CREATE INDEX statements if any
```

### Migrations
- [ ] Migration `NNN_description.sql` — what it does
- [ ] Rollback `NNN_description_rollback.sql` — what it reverts

---

## Security Considerations

- [ ] New endpoints require authentication: {{which ones}}
- [ ] New endpoints require specific permissions: {{which ones}}
- [ ] Input validated against: {{Joi schema name}}
- [ ] Rate limiting: {{which endpoints, what limits}}
- [ ] Sensitive data in responses: {{what data, how masked}}
- [ ] SQL injection protection: {{parameterized queries used}}

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: [Description and mitigation]
- **[Risk]**: [Description and mitigation]

### Frontend Risks
- **[Risk]**: [Description and mitigation]
- **[Risk]**: [Description and mitigation]

### Integration Risks
- **[Risk]**: [Description and mitigation]
- **[Risk]**: [Description and mitigation]

### Edge Cases
- [Edge case 1]: [How it's handled]
- [Edge case 2]: [How it's handled]
- [Edge case 3]: [How it's handled]

---

## Alternative Designs Considered

### Alternative 1: [Description]
- **Pros**: [Why it's attractive]
- **Cons**: [Why it's not chosen]
- **Decision**: [Why Option A/B/C is better]

### Alternative 2: [Description]
- **Pros**: [Why it's attractive]
- **Cons**: [Why it's not chosen]
- **Decision**: [Why Option A/B/C is better]

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
