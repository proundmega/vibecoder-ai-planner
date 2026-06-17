# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: [TICKET-ID] — [Title]

**Status**: planned | in_progress | completed | blocked
**Priority**: P0 | P1 | P2 | P3 | P4
**Effort**: Small | Medium | Large
**Author**: [Name]
**Date created**: YYYY-MM-DD
**Date completed**: YYYY-MM-DD
**PR**: [link]
**Branch**: [branch-name]
**Scope**: Frontend | Backend | Both

**Dependencies**: [ticket IDs that must be completed first]

---

### a) Purpose

[Why does this ticket exist? What problem does it solve? What value does it deliver?]

---

### b) Actions

**CRITICAL**: Before implementing, check if the feature can be added to existing code rather than creating new files.

#### Phase 1: Backend (if API doesn't exist)

If the backend API already exists, skip this phase and note "Backend API already exists — no changes needed."

1. Create route module: `backend/src/api/[feature].js`
   - Follow pattern from `backend/src/api/github.js`, `backend/src/api/providers.js`
   - Use Express Router
   - Add JSDoc annotations for OpenAPI spec
   - Mount in `backend/src/api/v1/index.js` or `backend/src/api/routes.js`

2. Create controller: `backend/src/controllers/[feature]Controller.js`
   - Follow pattern from `backend/src/controllers/githubController.js`
   - Export functions accepting `(req, res, next)`
   - Standardize response: `{ success: true, data: { ... } }`
   - Always pass errors to `next(error)`

3. Create service: `backend/src/services/[Feature]Service.js`
   - Follow pattern from `backend/src/services/GitHubService.js`
   - Framework-agnostic (no req/res)
   - Business logic only

4. Create validator: `backend/src/validators/[feature].js`
   - Follow pattern from `backend/src/validators/github.js`
   - Use Joi schemas
   - Apply via `validate(schema)` middleware

5. Create model (if new DB table): `backend/src/models/[feature].js`
   - Follow pattern from `backend/src/models/ticket.js`
   - Use parameterized queries
   - Add `fromRow()` method

6. Create migration (if new DB table): `backend/src/migrations/NNN_[feature].sql`
   - Follow naming convention: `NNN_` sequential number
   - Add to migration apply order in `AGENTS.md`

#### Phase 2: Frontend API Client

If the frontend API client already exists, skip this phase and note "Frontend API client already exists — no changes needed."

1. Create API client: `frontend/src/api/[feature].js`
   - Follow pattern from `frontend/src/api/github.js`, `frontend/src/api/tickets.js`
   - Import `{ get, post, put, del, patch } from './client'`
   - Use `.catch(() => [])` for list operations, `.catch(() => null)` for single item
   - Function names: `fetchX`, `getX`, `createX`, `updateX`, `deleteX`

#### Phase 3: Frontend UI

If the UI already exists, skip this phase and note "UI already exists — no changes needed."

**CRITICAL**: Check if this feature should be added to an existing view/tab rather than creating a new page.

1. Check existing views:
   - `frontend/src/views/ProjectDetail.vue` — Project settings (has tabs: Tickets, AI Assistant)
   - `frontend/src/views/TicketDetail.vue` — Ticket details (has sections: description, status, comments, attachments)
   - `frontend/src/views/Dashboard.vue` — Dashboard overview
   - `frontend/src/views/ProjectList.vue` — Project listing

2. Check existing tabs/sections:
   - If `ProjectDetail.vue` has tabs, add a new tab: `tabs.push({ id: 'new', label: 'New' })`
   - Add panel: `<div v-if="activeTab === 'new'" class="tab-panel">...</div>`
   - Follow existing CSS classes: `.tab-panel`, `.panel`, `.btn-primary`

3. Check existing modals:
   - `frontend/src/components/TicketEditModal.vue` — Ticket editing
   - `frontend/src/components/UserModal.vue` — User editing
   - If new form is related, extend existing modal instead of creating new one

4. Create/extend view:
   - If adding tab: Modify existing view, add tab and panel
   - If adding section: Modify existing view, add section div
   - If new page: Create new view + add route + add navigation link

5. Update router (if new page):
   - `frontend/src/router/index.ts` — Add route
   - `frontend/src/views/ProjectList.vue` — Add navigation link

#### Phase 4: Integration

1. Update OpenAPI spec:
   - Add JSDoc annotations to backend routes
   - Run `cd frontend && npm run generate:spec`
   - Run `cd frontend && npm run generate:api`

2. Update generated types:
   - Verify `frontend/src/api/generated/` has new types
   - Run `cd frontend && npm run typecheck`

3. Update response validation:
   - `frontend/src/api/validator.ts` — If response shapes changed

---

### c) Dependencies

- [Backend service]: [what it provides]
- [Frontend API client]: [what it provides]
- [Existing UI pattern]: [what to follow]
- [OpenAPI spec]: [what to update]

---

### d) Risks/Edge Cases

- **[Risk name]**: [description and mitigation]
- **[Edge case]**: [description and handling]

---

### e) Testing

#### Backend Unit Tests
- [ ] Test controller: `backend/src/__tests__/api-[feature].test.js`
- [ ] Test service: `backend/src/__tests__/unit.test.js`
- [ ] Test middleware: `backend/src/middleware/*.test.js` (if auth/permissions affected)

#### Backend Integration Tests
- [ ] Full request lifecycle: HTTP → middleware → controller → service → DB → response
- [ ] Role-based access: correct 403 responses
- [ ] Data persistence: inserted/updated data survives across requests
- [ ] Error handling: invalid requests return proper error responses

#### Frontend Unit Tests
- [ ] API client: `frontend/src/__tests__/[feature].test.js`
- [ ] Component rendering: if new UI component

#### Frontend E2E Tests
- [ ] User flow: [describe the flow to test]
- [ ] Auth flow: [describe if auth is involved]

#### Frontend Contract Tests
- [ ] Response shapes match OpenAPI spec: `frontend/src/__tests__/api-contract.test.ts`
- [ ] Field names match (snake_case vs camelCase)

---

### f) Migration Notes (if applicable)

```sql
-- Migration SQL here
```

- [ ] Migration file: `backend/src/migrations/NNN_[name].sql`
- [ ] Migration applied in `AGENTS.md` migration order
- [ ] Rollback plan: [describe how to rollback]

---

### g) Files Changed

**Backend:**
```
backend/src/api/[feature].js          → new route module
backend/src/controllers/[feature]Controller.js  → new controller
backend/src/services/[Feature]Service.js      → new service
backend/src/validators/[feature].js           → new validator
backend/src/models/[feature].js               → new model (if applicable)
backend/src/migrations/NNN_[feature].sql      → new migration (if applicable)
backend/src/api/v1/index.js                   → mount route (if new API)
backend/src/api/openapi-spec.js               → JSDoc annotations (if new API)
```

**Frontend:**
```
frontend/src/api/[feature].js         → new API client
frontend/src/views/[Feature].vue      → new view (if new page)
frontend/src/views/ProjectDetail.vue  → extend with tab (if extending)
frontend/src/views/TicketDetail.vue   → extend with section (if extending)
frontend/src/components/[Feature].vue → new component (if new modal/form)
frontend/src/router/index.ts          → add route (if new page)
frontend/src/api/generated/           → regenerated types
```

---

### h) Code Review Checklist

- [ ] Backend follows existing patterns (controller/service/model separation)
- [ ] Backend uses parameterized queries (no SQL injection)
- [ ] Backend has JSDoc OpenAPI annotations
- [ ] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [ ] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [ ] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [ ] Frontend types match backend response shapes
- [ ] All tests written and passing
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed

---

### i) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes (if applicable)
3. [ ] Backend: `npm run lint` passes
4. [ ] Frontend: `npm run lint` passes
5. [ ] Frontend: `npm run typecheck` passes
6. [ ] Frontend: `npm run build` passes
7. [ ] Frontend: `npm test -- --run` passes
8. [ ] API endpoint responds correctly: `curl http://localhost:3001/api/v1/[feature]`
9. [ ] Frontend UI loads correctly in browser
10. [ ] Auth/permissions work correctly
11. [ ] Error cases handled gracefully

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
