# 03_ARCHITECT_IMPLEMENTATION.md — Frontend API Unit Tests (Uncovered Modules)

**Status**: completed
**Priority**: P3 (Low-Medium)
**Effort**: Small (~2-3 hours)
**Author**: AI Assistant
**Date created**: 2026-06-22
**Date completed**: 2026-06-22
**PR**: TBD
**Branch**: bp-17-frontend-api-tests

**Dependencies**: None

---

### a) Purpose

Add Vitest unit tests for 7 untested frontend API modules: `usage.js`, `billing.js`, `providers.js`, `memory.js`, `github.js`, `ticketPlanning.js`, `ticketAttachments.js`. Each module is a thin wrapper around `client.js` — tests verify correct URL construction, HTTP method selection, and parameter passing.

**Value delivered**: Regression protection for API layer. URL typos, wrong methods, or missing body fields caught by fast unit tests instead of slow Cypress e2e.

---

### b) Actions

#### Step 1: `frontend/src/__tests__/usage.test.js`
- Mock `../api/client` → `{ get: vi.fn() }`
- Test `getProjectUsage('proj-123')` calls `get('/api/v1/usage/projects/proj-123/usage')`
- Test `getProjectUsage()` returns `null` on error (`.catch(() => null)`)
- Test `getUserUsage()` calls `get('/api/v1/usage/users/me/usage')`
- Test `getModelPricing()` calls `get('/api/v1/usage/pricing/models')`
- Test `getModelPricing()` returns `[]` on error

#### Step 2: `frontend/src/__tests__/billing.test.js`
- Mock `../api/client` → `{ get: vi.fn() }`
- Test `getProjectBilling('proj-123')` calls `get('/api/v1/billing/projects/proj-123/billing')`
- Test `getProjectBilling()` returns `null` on error
- Test `getUserBilling()` calls `get('/api/v1/billing/users/me/billing')`
- Test `getUserBilling()` returns `null` on error

#### Step 3: `frontend/src/__tests__/providers.test.js`
- Mock `../api/client` → `{ get: vi.fn(), post: vi.fn(), patch: vi.fn(), del: vi.fn() }`
- Test `listProviders('p1')` → GET `/api/v1/providers/p1/providers`
- Test `listProviders()` returns `[]` on error
- Test `addProvider('p1', 'OpenAI', 'openai', 'sk-xxx')` → POST with body
- Test `updateProvider('p1', 'prov-1', { name: 'Updated' })` → PATCH
- Test `deleteProvider('p1', 'prov-1')` → DELETE
- Test `testProvider('p1', 'prov-1')` → POST

#### Step 4: `frontend/src/__tests__/memory.test.js`
- Mock `../api/client` → `{ get: vi.fn(), post: vi.fn(), put: vi.fn(), del: vi.fn() }`
- Test `getProjectMemory('p1')` → GET `/api/v1/memory/project/p1`
- Test `searchMemory('p1', 'bug')` → GET with `{ params: { q: 'bug' } }`
- Test `getAgentMemory('a1')` → GET `/api/v1/memory/agent/a1`
- Test `getMemory('m1')` → GET `/api/v1/memory/m1`
- Test `addMemory('p1', 'content', { key: 'val' })` → POST
- Test `updateMemory('m1', { content: 'new' })` → PUT
- Test `deleteMemory('m1')` → DELETE

#### Step 5: `frontend/src/__tests__/github.test.js`
- Mock `../api/client` → `{ get: vi.fn(), post: vi.fn(), del: vi.fn() }`
- Test all 8 functions verify URL + method
- Test read functions (`getRepoStatus`, `listBranches`, `listPRs`) return `null`/`[]` on error

#### Step 6: `frontend/src/__tests__/ticketPlanning.test.js`
- Mock `../api/client` → `{ get: vi.fn(), put: vi.fn(), post: vi.fn(), patch: vi.fn() }`
- Test `listPlanningFiles('t1')` → GET `/api/v1/tickets/t1/planning`
- Test `getPlanningFile('t1', 'design.md')` → GET `/api/v1/tickets/t1/planning/design.md`
- Test `upsertPlanningFile('t1', 'design.md', '# Title')` → PUT with body
- Test `applyTemplate('t1', 'feature')` → POST with body
- Test `updatePlanningStatus('t1', 'in_progress')` → PATCH with body

#### Step 7: `frontend/src/__tests__/ticketAttachments.test.js`
- Mock `../api/client` → `{ get: vi.fn(), del: vi.fn(), postMultipart: vi.fn() }`
- Test `fetchAttachments('t1')` → GET `/api/v1/tickets/t1/attachments`
- Test `uploadAttachment('t1', mockFile)` → `postMultipart` called with correct URL and `FormData` instance
- Test `deleteAttachment('t1', 'att-1')` → DELETE

#### Step 8: Verification
- `cd frontend && npm test -- --run` — all 16 test files pass
- `cd frontend && npm run lint` — no errors
- `cd frontend && npm run typecheck` — no type errors
- `cd frontend && npm run build` — succeeds

---

### c) Dependencies

- **None** — self-contained change, only adds test files
- **Vitest** — already configured
- **`../api/client`** — mocked in all new tests

---

### d) Risks/Edge Cases

- **[FormData in uploadAttachment]**: Creates a real `FormData` object in the test. Just verify `postMultipart` is called with a `FormData` instance — no need to validate content.
- **[Query params in searchMemory]**: Must verify `{ params: { q: 'query' } }` is passed to `get()`, not URL-encoded string.
- **[Memory leak from vi.mock]**: `beforeEach(() => vi.clearAllMocks())` required in each file.

---

### e) Testing

#### Unit Tests (new)
- [ ] `usage.test.js` — 3 functions, 6 tests
- [ ] `billing.test.js` — 2 functions, 4 tests
- [ ] `providers.test.js` — 5 functions, 10 tests
- [ ] `memory.test.js` — 7 functions, 14 tests
- [ ] `github.test.js` — 8 functions, 16 tests
- [ ] `ticketPlanning.test.js` — 5 functions, 10 tests
- [ ] `ticketAttachments.test.js` — 3 functions, 6 tests
- **Total**: ~66 new tests across 7 files

#### Existing Tests (regression)
- [ ] All 9 existing test files still pass
- [ ] No new lint warnings

---

### f) Rollback Plan

- **How**: `git revert <commit>` — single commit revert
- **Data impact**: None — only adds test files
- **Downtime**: None — no production code changes
- **Verification after rollback**: Run `npm test -- --run` to confirm original 9 tests pass

---

### g) Files Changed

- `frontend/src/__tests__/usage.test.js` — NEW
- `frontend/src/__tests__/billing.test.js` — NEW
- `frontend/src/__tests__/providers.test.js` — NEW
- `frontend/src/__tests__/memory.test.js` — NEW
- `frontend/src/__tests__/github.test.js` — NEW
- `frontend/src/__tests__/ticketPlanning.test.js` — NEW
- `frontend/src/__tests__/ticketAttachments.test.js` — NEW

---

### h) Code Review Checklist

- [ ] Each test uses `vi.mock('../api/client')` pattern matching existing files
- [ ] `beforeEach(() => vi.clearAllMocks())` present in each file
- [ ] All exported functions have at least one test
- [ ] Error fallbacks tested (`.catch(() => [])` returns `[]`, `.catch(() => null)` returns `null`)
- [ ] `memory.test.js` verifies `{ params: { q: query } }` for search
- [ ] `ticketAttachments.test.js` verifies `FormData` is passed to `postMultipart`
- [ ] No `global.fetch` mocks in API module tests (use `client` mocks instead)
- [ ] No Vue component imports in test files
- [ ] Test names follow existing convention: `'sends GET request to correct URL'`, `'returns null on error'`

---

### i) Post-Deploy Verification

- `cd frontend && npm test -- --run` — all tests pass
- `cd frontend && npm run lint` — no errors
- `cd frontend && npm run typecheck` — no type errors
- `cd frontend && npm run build` — succeeds

---

### j) Migration Notes

None — pure test file additions.

---

### k) Notes

- Follows the exact pattern from existing test files (`projects.test.js`, `users.test.js`, etc.)
- Each test verifies: (1) correct function called with correct URL, (2) correct HTTP method, (3) correct body/params, (4) error fallback
- Total ~66 new tests across 7 files, ~9-10 tests per module
- Router intentionally excluded — requires heavy Vue app setup, covered by Cypress e2e

---

*This ticket follows the 3 ARCHITECT templates:*
- *`01_ARCHITECT_REQUIREMENT.md` → Requirements, scope, testing checklist, CI requirements*
- *`02_ARCHITECT_DESIGN.md` → Module-by-module test plan, URL patterns, design decisions*
- *`03_ARCHITECT_IMPLEMENTATION.md` → Purpose, actions, dependencies, risks, testing*
