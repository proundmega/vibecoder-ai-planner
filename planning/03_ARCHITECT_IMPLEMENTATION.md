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

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **[Step 1 name]** — {{file path}}
   - Sub-step
   - Sub-step
   - *Depends on*: nothing

2. **[Step 2 name]** — {{file path}}
   - Sub-step
   - *Depends on*: Step 1

3. **[Step 3 name]** — {{file path}}
   - Sub-step
   - *Depends on*: Step 1, Step 2

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

### c) Per-File Action Plan

For each file being created or modified, specify exactly what changes:

#### `backend/src/services/FooService.js` (MODIFY)
- **Add method**: `async createFoo(data: CreateFooInput): Promise<Foo>`
- **Logic**: validate input → INSERT into DB → return created record
- **Error cases**: duplicate key → throw 409, missing field → throw 400
- **Imports needed**: `const db = require('../db')`
- **Position in file**: Add after `listFoo()` method

#### `frontend/src/api/foo.js` (CREATE)
- **Exports**: `export async function createFoo(data) { ... }`
- **HTTP call**: `POST /api/v1/foo` with JSON body
- **Error handling**: `.catch(() => null)`
- **Follow pattern**: `frontend/src/api/tickets.js`

#### `frontend/src/views/FooList.vue` (MODIFY)
- **Add**: "Create Foo" button in header
- **Add**: Form modal for creating a new Foo
- **Follow pattern**: Existing modals in `TicketEditModal.vue`
- **State**: `showCreateModal: ref(false)`, `newFoo: ref({ name: '', description: '' })`

---

### d) Dependencies

- [Backend service]: [what it provides]
- [Frontend API client]: [what it provides]
- [Existing UI pattern]: [what to follow]
- [OpenAPI spec]: [what to update]
- [Specification file]: `04_SPECIFICATION.md` — if this file exists, follow it exactly for file operations, signatures, and test expectations

---

### e) Risks/Edge Cases

- **[Risk name]**: [description and mitigation]
- **[Edge case]**: [description and handling]

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Test-First Requirement

If `04_SPECIFICATION.md` exists, the implementing model MUST create **empty test stub files** (with imports, `describe` blocks, and stub `it` blocks) **before** creating any production code. Test stubs are listed as the first file operations in `04_SPECIFICATION.md`.

#### Backend Unit Tests
- [ ] Test controller: `backend/src/__tests__/api-[feature].test.js` — CREATED or EXTENDED
- [ ] Test service: `backend/src/__tests__/unit.test.js` — CREATED or EXTENDED
- [ ] Test middleware: `backend/src/middleware/*.test.js` (if auth/permissions affected) — CREATED or EXTENDED
- [ ] Every new controller method has at least one test case
- [ ] Every new service method has at least one test case
- [ ] Every new validator schema has at least one test case
- [ ] Happy path AND error paths tested (not just happy path)
- [ ] **Coverage threshold (60%)**: run `npm run test:coverage` — must pass 60% min on lines, functions, branches, statements

#### Backend Jest Integration Tests
- [ ] Full request lifecycle: HTTP → middleware → controller → service → DB → response
- [ ] Role-based access: correct 403 responses
- [ ] Data persistence: inserted/updated data survives across requests
- [ ] Error handling: invalid requests return proper error responses

#### Backend Bash Integration Suite
**Add a curl-based test in `backend/integration-test/suites/` for backend API changes.**
- [ ] New suite file: `backend/integration-test/suites/[feature].test.sh` — CREATED
- [ ] Test function registered in `backend/integration-test/run.sh` `main()` function
- [ ] Suite covers: happy path (200/201), auth failure (401), permission denial (403), validation error (400), not-found (404)
- [ ] Multi-step flows tested where applicable (create → read → update → delete → verify gone)
- [ ] Suite runs cleanly: `cd backend && bash integration-test/run.sh --only`

#### Frontend Unit Tests
- [ ] API client: `frontend/src/__tests__/[feature].test.js` — CREATED or EXTENDED
- [ ] Component rendering: if new UI component — CREATED or EXTENDED
- [ ] Every new API client function has at least one test case
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

#### Frontend E2E Tests
- [ ] User flow: [describe the flow to test]
- [ ] Auth flow: [describe if auth is involved]

#### Frontend Contract Tests
- [ ] Response schema updated in `frontend/src/api/validator.ts` if response shapes changed
- [ ] Contract test: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED with new field/enum tests
- [ ] Field names match (snake_case vs camelCase — `validator.ts` should catch mismatches)
- [ ] Generated types regenerated: `npm run generate:spec && npm run generate:api` (after backend JSDoc updates)
- [ ] Generated types compile: `npm run typecheck`

---

### g) Migration Notes (if applicable)

```sql
-- Migration SQL here
```

- [ ] Migration file: `backend/src/migrations/NNN_[name].sql`
- [ ] Migration applied in correct position in `backend/src/migrations/apply.js`
- [ ] Rollback file: `backend/src/migrations/NNN_[name]_rollback.sql`
- [ ] Rollback tested: can reverse without data loss

---

### h) Files Changed

**Backend:**
```
backend/src/api/[feature].js          → CREATE (route module)
backend/src/controllers/[feature]Controller.js  → CREATE (controller)
backend/src/services/[Feature]Service.js      → CREATE (service)
backend/src/validators/[feature].js           → CREATE (validator)
backend/src/models/[feature].js               → CREATE (model, if applicable)
backend/src/migrations/NNN_[feature].sql      → CREATE (migration, if applicable)
backend/src/migrations/apply.js               → MODIFY (add to SQL_FILES array)
backend/src/api/v1/index.js                   → MODIFY (mount route, if new API)
```

**Frontend:**
```
frontend/src/api/[feature].js         → CREATE (API client)
frontend/src/views/[Feature].vue      → CREATE (view, if new page)
frontend/src/views/ProjectDetail.vue  → MODIFY (extend with tab, if applicable)
frontend/src/views/TicketDetail.vue   → MODIFY (extend with section, if applicable)
frontend/src/components/[Feature].vue → CREATE (component, if new modal/form)
frontend/src/router/index.ts          → MODIFY (add route, if new page)
frontend/src/api/generated/           → REGENERATE (types)
```

---

### i) Code Review Checklist

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
- [ ] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [ ] OpenAPI spec regenerated if backend routes changed
- [ ] Generated TypeScript types regenerated if response shapes changed
- [ ] Generated types compile: `npm run typecheck`
- [ ] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [ ] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers any new/changed fields
- [ ] Bash integration suite test added or extended for API changes
- [ ] **Coverage threshold enforced**: `npm run test:coverage` (backend) or `npm test -- --run --coverage` (frontend) — min 60% lines, functions, branches, statements
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes (if applicable)
3. [ ] **Backend: `cd backend && bash integration-test/run.sh --only` passes (if backend API changed)**
4. [ ] Backend: `npm run lint` passes
5. [ ] **Backend: `npm run test:coverage` passes (60% min threshold)**
6. [ ] Frontend: `npm run lint` passes
7. [ ] Frontend: `npm run typecheck` passes
8. [ ] Frontend: `npm run build` passes
9. [ ] Frontend: `npm test -- --run --coverage` passes (60% min threshold)
10. [ ] API endpoint responds correctly: `curl http://localhost:3001/api/v1/[feature]`
11. [ ] Frontend UI loads correctly in browser
12. [ ] Auth/permissions work correctly
13. [ ] Error cases handled gracefully
14. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
