# 01_ARCHITECT_REQUIREMENT.md — Frontend API Unit Tests (Uncovered Modules)

**Status**: completed
**Date created**: 2026-06-22
**Date completed**: 2026-06-22
**Author**: AI Assistant

---

## Requirement

Add Vitest unit tests for all frontend API modules that currently have zero test coverage. The existing test suite covers `client.js`, `auth.js`, `projects.js`, `tickets.js`, `users.js`, `agents.js`, `approvals.js`, `auth-store.js`, and `api-contract.test.ts`. Seven API modules and the router remain untested.

---

## Existing Infrastructure Audit

**Already tested** (9 files in `frontend/src/__tests__/`):
- `client.test.js` — HTTP client wrapper (mocks `global.fetch`)
- `auth.test.js` — register/login/getCurrentUser (mocks `global.fetch`)
- `projects.test.js` — CRUD operations (mocks `../api/client`)
- `tickets.test.js` — CRUD + comments (mocks `../api/client`)
- `users.test.js` — CRUD + toggle (mocks `../api/client`)
- `agents.test.js` — agent endpoints (mocks `../api/client`)
- `approvals.test.js` — create/approve/reject (mocks `../api/client`)
- `auth-store.test.js` — Pinia store (mocks `../api/auth`)
- `api-contract.test.ts` — validator schema validation

**Pattern**: All module tests mock `../api/client` with `vi.mock()` and use `await import('../api/client')` inside test bodies to access the mock. Auth/test files that call `fetch` directly mock `global.fetch`.

**Not tested** (7 API modules + router):
| Module | Functions | Lines | Complexity |
|--------|-----------|-------|------------|
| `usage.js` | getProjectUsage, getUserUsage, getModelPricing | 13 | Trivial |
| `billing.js` | getProjectBilling, getUserBilling | 9 | Trivial |
| `providers.js` | list, add, update, delete, test | 21 | Low |
| `memory.js` | getProjectMemory, searchMemory, getAgentMemory, get, add, update, delete | 29 | Low (params) |
| `github.js` | getRepoStatus, connectRepo, disconnectRepo, listBranches, createBranch, deleteBranch, listPRs, createPR | 33 | Low |
| `ticketPlanning.js` | list, get, upsert, applyTemplate, updateStatus | 21 | Low |
| `ticketAttachments.js` | fetch, upload (FormData), delete | 15 | Low (multipart) |
| `router/index.ts` | route definitions, guards, navigation | — | Medium (Vue Router setup) |

---

## Scope

**In scope**: Unit tests for the 7 untested API modules. Each test file mocks `../api/client` and verifies correct URL construction, HTTP method selection, and parameter passing.

**Out of scope**:
- Vue component tests (Cypress component tests cover those)
- Router tests (covered by Cypress e2e tests; router requires Vue Router app context which is heavy to set up)
- Store tests (already covered by `auth-store.test.js`)
- Integration/e2e tests (Cypress covers those)

---

## Acceptance Criteria

- [ ] 7 new test files created: `usage.test.js`, `billing.test.js`, `providers.test.js`, `memory.test.js`, `github.test.js`, `ticketPlanning.test.js`, `ticketAttachments.test.js`
- [ ] Each function in the 7 modules has at least one test verifying correct API call (URL + method + body)
- [ ] Error handling paths tested where applicable (`.catch()` fallbacks)
- [ ] `memory.test.js` tests query parameter passing for search
- [ ] `ticketAttachments.test.js` tests `postMultipart` path (FormData)
- [ ] All new tests pass: `cd frontend && npm test -- --run`
- [ ] No regression in existing 9 test files
- [ ] Lint passes: `cd frontend && npm run lint`
- [ ] Build succeeds: `cd frontend && npm run build`

---

## Out of Scope

- Router unit tests (Vue Router needs app instantiation, heavy for what is essentially config)
- View/page component tests (Cypress e2e covers these)
- `validator.ts` tests (already covered by `api-contract.test.ts`)
- `api/generated/` types (auto-generated, no logic to test)

---

## Testing Checklist

- [ ] Each module test verifies correct endpoint URL for every exported function
- [ ] POST/PUT/PATCH/DELETE methods verified where applicable
- [ ] Query params tested for memory search
- [ ] FormData/multipart tested for attachment upload
- [ ] Error fallbacks tested (`.catch(() => [])` returns empty array, `.catch(() => null)` returns null)
- [ ] `beforeEach` clears mocks
- [ ] Tests use `vi.mock('../api/client')` pattern matching existing test files

---

## CI Requirements (MANDATORY)

- `cd frontend && npm test -- --run` — all tests pass (existing + new)
- `cd frontend && npm run lint` — no errors
- `cd frontend && npm run typecheck` — no type errors
- `cd frontend && npm run build` — succeeds

---

## Anti-Patterns to Avoid

- ❌ Don't test the router — Vue Router needs full app context, and Cypress e2e already covers navigation
- ❌ Don't mock `global.fetch` for API modules — they use `client.js` which should be mocked instead
- ❌ Don't test `validator.ts` — already covered by `api-contract.test.ts`
- ❌ Don't add `cy.wait()` or hardcoded timeouts — use `vi.waitFor()` if async waiting needed
- ❌ Don't import Vue components into test files — these are pure API modules

---

*Ready for design phase.*
