# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**: {{YYYY-MM-DD}}
**Author**: AI Assistant
**Scope**: Backend | Frontend
**Priority**: P1
**Effort**: Medium
**Related**: bp-54 (Error Handling)

---

## Requirement

bp-54 introduced a structured error handling system including:
- `response.js` helpers (`sendSuccess`/`sendError`)
- `AppError` class hierarchy with 10 error codes
- `ErrorToast` frontend component for displaying errors
- `useAsyncState` composable for async state management
- Console call removal policy (zero `console.*` calls in production code)

However, none of these new components have corresponding tests. This ticket backfills all missing test coverage.

---

## Existing Infrastructure Audit

### Backend API Check
- [ ] `response.js` helpers exist: `backend/src/utils/response.js` — YES (`sendSuccess`, `sendError`)
- [ ] `AppError` class exists: `backend/src/errors/HttpError.js` — YES (extends AppError with 10 codes)
- [ ] Existing test patterns: `backend/src/__tests__/` — verify

### Frontend API Client Check
- [ ] `ErrorToast` component exists: `frontend/src/components/ErrorToast.vue` — verify
- [ ] `useAsyncState` composable exists: `frontend/src/composables/useAsyncState.ts` — verify
- [ ] Existing test patterns: `frontend/src/__tests__/`, `frontend/cypress/component/` — verify

### Key Insight

This is a **test-only** ticket. All production code from bp-54 already exists. The task is to create tests for:
1. `sendSuccess`/`sendError` helpers (backend unit tests)
2. `AppError` class hierarchy (backend unit tests)
3. Zero `console.*` calls verification (regex scan test)
4. All 10 error codes in the taxonomy (backend unit tests)
5. `ErrorToast` component rendering and auto-dismiss (frontend component test)
6. `useAsyncState` composable states (frontend unit test)
7. Auth flow regression (login, register, token refresh) (backend integration test)

---

## Scope

### In Scope
- Create `backend/src/__tests__/responseHelpers.test.js` — test `sendSuccess`/`sendError`
- Create `backend/src/__tests__/appErrorHierarchy.test.js` — test `AppError` class and 10 error codes
- Create `backend/src/__tests__/noConsoleCalls.test.js` — regex scan for `console.*` calls
- Create `frontend/cypress/component/ErrorToast.spec.ts` — test ErrorToast rendering and auto-dismiss
- Create `frontend/src/__tests__/useAsyncState.test.ts` — test useAsyncState composable
- Create `backend/src/__tests__/integration/authFlowRegression.test.js` — test login/register/token refresh
- Extend `frontend/src/__tests__/` with error handling tests

### Out of Scope
- Modifying any production code from bp-54
- Creating tests for unrelated error handling scenarios
- Changes to the error handling implementation itself

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/__tests__/responseHelpers.test.js` | CREATE | Test sendSuccess/sendError |
| `backend/src/__tests__/appErrorHierarchy.test.js` | CREATE | Test AppError + 10 error codes |
| `backend/src/__tests__/noConsoleCalls.test.js` | CREATE | Regex scan for console.* |
| `frontend/cypress/component/ErrorToast.spec.ts` | CREATE | Component test for ErrorToast |
| `frontend/src/__tests__/useAsyncState.test.ts` | CREATE | Composable test for useAsyncState |
| `backend/src/__tests__/integration/authFlowRegression.test.js` | CREATE | Auth flow regression tests |

---

## Known Unknowns

1. **[Error code list]**: What are the exact 10 error codes in the taxonomy? Need to check `backend/src/errors/HttpError.js`.
2. **[ErrorToast component]**: Does ErrorToast exist in `frontend/src/components/`? Need to verify.
3. **[useAsyncState composable]**: Does it exist in `frontend/src/composables/`? Need to verify.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

---

## Acceptance Criteria

1. [ ] `sendSuccess` test verifies `{ success: true, data: ..., requestId }` response shape
2. [ ] `sendError` test verifies `{ success: false, error: { code, message } }` response shape
3. [ ] `AppError` test verifies `instanceof Error` and custom properties
4. [ ] All 10 error codes tested (BAD_REQUEST, UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT, UNPROCESSABLE, RATE_LIMITED, INTERNAL, SERVICE_UNAVAILABLE, GONE)
5. [ ] Zero `console.*` scan test verifies no `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug` in production code
6. [ ] `ErrorToast` renders error message when props passed
7. [ ] `ErrorToast` auto-dismisses after configured timeout (default 5s)
8. [ ] `useAsyncState` returns `{ loading: true }` initially
9. [ ] `useAsyncState` returns `{ loading: false, data: ... }` on success
10. [ ] `useAsyncState` returns `{ loading: false, error: ... }` on failure
11. [ ] Auth flow regression: login succeeds with valid credentials
12. [ ] Auth flow regression: register succeeds with valid data
13. [ ] Auth flow regression: token refresh returns new token
14. [ ] `npm test` passes with no regressions
15. [ ] `npm test -- --run` passes for frontend

---

## Testing Checklist

### Backend Tests
- [ ] `backend/src/__tests__/responseHelpers.test.js` — CREATED
- [ ] `backend/src/__tests__/appErrorHierarchy.test.js` — CREATED
- [ ] `backend/src/__tests__/noConsoleCalls.test.js` — CREATED
- [ ] `backend/src/__tests__/integration/authFlowRegression.test.js` — CREATED

### Frontend Tests
- [ ] `frontend/cypress/component/ErrorToast.spec.ts` — CREATED
- [ ] `frontend/src/__tests__/useAsyncState.test.ts` — CREATED

### CI Requirements
- [ ] `npm test` — backend unit tests pass
- [ ] `npm run lint` — no lint errors
- [ ] `npm run typecheck` — frontend typecheck passes
- [ ] `npm run build` — frontend build passes
- [ ] `npm test -- --run` — frontend tests pass

---

## Anti-Patterns to Avoid

- ❌ **Testing only happy paths** — test error cases, edge cases
- ❌ **Creating new production code** — this is a test-only ticket
- ❌ **No regression test** — every new test must verify the specific bp-54 behavior
- ❌ **Skipping the console scan** — zero console.* calls is a hard requirement

---

*Fill in all sections before starting implementation.*
