# 00_ARCHITECT_CHECKLIST.md — Frontend API Unit Tests (Uncovered Modules)

**Status**: completed
**Date created**: 2026-06-22
**Date completed**: 2026-06-22

---

## Existing Infrastructure Audit

**What already exists**:
- 9 test files in `frontend/src/__tests__/` covering `client.js`, `auth.js`, `projects.js`, `tickets.js`, `users.js`, `agents.js`, `approvals.js`, `auth-store.js`, `api-contract.test.ts`
- Vitest configured, picks up `src/__tests__/*.test.js`
- Consistent test pattern: `vi.mock('../api/client')` + `await import('../api/client')` inside test bodies
- Cypress e2e tests cover navigation, component rendering, and full API flows

**What's missing**:
- 7 API modules have zero test coverage: `usage.js`, `billing.js`, `providers.js`, `memory.js`, `github.js`, `ticketPlanning.js`, `ticketAttachments.js`
- Router (`router/index.ts`) untested (intentionally out of scope — covered by Cypress)

**What we're extending**: The existing test pattern. No new infrastructure needed.

---

## Pre-Implementation Checklist

- [ ] Read `01_ARCHITECT_REQUIREMENT.md` — scope and acceptance criteria
- [ ] Read `02_ARCHITECT_DESIGN.md` — module-by-module test plan
- [ ] Read `03_ARCHITECT_IMPLEMENTATION.md` — implementation steps
- [ ] Confirm 7 modules are the only untested API modules (verified: yes)
- [ ] Confirm router is intentionally out of scope (verified: Cypress e2e covers it)
- [ ] Verify existing tests pass: `cd frontend && npm test -- --run`
- [ ] Verify no conflicts with existing test files

---

## Post-Implementation Checklist

- [ ] 7 new test files created
- [ ] All 16 test files pass: `cd frontend && npm test -- --run`
- [ ] Lint passes: `cd frontend && npm run lint`
- [ ] Typecheck passes: `cd frontend && npm run typecheck`
- [ ] Build succeeds: `cd frontend && npm run build`
- [ ] No regression in existing 9 test files
- [ ] Each new test file follows the `vi.mock('../api/client')` pattern
- [ ] `beforeEach(() => vi.clearAllMocks())` present in each file
- [ ] All exported functions have at least one test
- [ ] Error fallbacks tested where `.catch()` is used
- [ ] `memory.test.js` verifies query params for search
- [ ] `ticketAttachments.test.js` verifies FormData for upload

---

## Files Created

| File | Functions Tested | Est. Tests |
|------|-----------------|------------|
| `usage.test.js` | 3 | 6 |
| `billing.test.js` | 2 | 4 |
| `providers.test.js` | 5 | 10 |
| `memory.test.js` | 7 | 14 |
| `github.test.js` | 8 | 16 |
| `ticketPlanning.test.js` | 5 | 10 |
| `ticketAttachments.test.js` | 3 | 6 |
| **Total** | **33** | **~66** |

---

*Complete the checklist after implementation. Update `03_ARCHITECT_IMPLEMENTATION.md` with date, PR URL, and branch.*
