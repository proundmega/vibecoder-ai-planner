# 01_ARCHITECT_REQUIREMENT.md — Fix Bash Integration Test Suite (Round 2)

**Status**: in_progress
**Date created**: 2026-07-06
**Date completed**: {{DATE}}
**Author**: AI Assistant
**Scope**: Backend | Tests
**Priority**: P1
**Effort**: Medium

---

## Requirement

After Round 1 fixes (rate limiter env var, assert_has_field, agent middleware), **74 out of 109 tests still fail**. The remaining failures are caused by:

1. **`assert_field` doesn't unwrap `.data`** — API returns `{ success: true, data: {...} }` but `assert_field` tries to extract fields from root level
2. **`register()`/`login()` return strings, tests pass constructed JSON** — Tests call `assert_has_field "Register" "token" "{\"token\":\"$token\"}"` but the constructed string is just `{"token":"eyJ..."}` which is valid JSON but the field check is wrong
3. **Tests reference `alice@integration.test`** — `clean_db` deletes all users but tests don't register fresh users first
4. **Wrong endpoints** — `agent_lifecycle.test.sh` calls `/agents/:id/pickup` (doesn't exist), should use `/tickets/:id/pickup`
5. **`status_transitions.test.sh` uses bare `/api/` paths** — Some status transition calls use `curl -sf POST /api/v1/...` but the `done → backlog` invalid test uses wrong path

---

## Existing Infrastructure Audit

### Backend API Check
- [x] API routes exist: `backend/src/api/` — YES
- [x] Controllers exist: `backend/src/controllers/` — YES
- [x] Services exist: `backend/src/services/` — YES
- [x] Route is mounted: `backend/src/api/v1/index.js` — YES

### Test Infrastructure Check
- [x] Integration test runner: `backend/integration-test/run.sh` — EXISTS (Round 1 fixed env var)
- [x] Test helpers: `backend/integration-test/helpers.sh` — EXISTS (needs `assert_field` fix)
- [x] Test suites: `backend/integration-test/suites/` — 27 suite files (need assertion fixes)

### Key Insight

**The root cause of most failures is `assert_field` not unwrapping the `.data` response wrapper.** The API returns `{ success: true, data: { id, name, ... } }` but `assert_field` tries `jq -r ".field"` which returns null because `field` is inside `data`.

---

## Scope

### In Scope
- Fix `assert_field` in `helpers.sh` to unwrap `.data` (and handle arrays)
- Fix `register()`/`login()` assertion patterns in all test suites
- Fix `agent_lifecycle.test.sh` to use `/tickets/:id/pickup` and `/tickets/:id/release`
- Fix `status_transitions.test.sh` to use correct `/api/v1/` paths
- Ensure all tests register fresh users (since `clean_db` deletes all users)

### Out of Scope
- Cypress component test failures (pre-existing)
- Frontend Vitest/Lint/TypeCheck issues (pre-existing)
- Creating new backend API endpoints
- Modifying backend business logic

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/integration-test/helpers.sh` | MODIFY | `assert_field` unwraps `.data` |
| `backend/integration-test/suites/agent_lifecycle.test.sh` | MODIFY | Use ticket pickup/release endpoints |
| `backend/integration-test/suites/status_transitions.test.sh` | MODIFY | Fix `/api/` paths |
| `backend/integration-test/suites/*.test.sh` | MODIFY | Fix register/login assertions |

| database | NONE | No schema changes |
| config | NONE | No new env vars |

---

## Known Unknowns

1. **Which test suites have broken register/login assertions?** — Need to grep all suites for `assert_has_field "Register"` and `assert_has_field "Login"` patterns.
2. **Do all tests need fresh user registration?** — `clean_db` deletes all users, so tests that reference `alice@integration.test` must register first.

---

## Important Design Decisions

**No design decisions require user input. All choices follow existing patterns.**

1. **assert_field fix**: Unwrap `.data` before field extraction. Handle both object and array cases (e.g., list endpoints return `{ data: [...] }`).
2. **Register/login assertions**: Change from `assert_has_field "Register" "token" "{\"token\":\"$token\"}"` to simple non-empty check: `if [ -n "$token" ]; then pass "Register"; else fail "Register"; fi`
3. **Agent endpoints**: Use existing `/tickets/:ticketId/pickup` and `/tickets/:ticketId/release` routes (already exist in `tickets.js`).
4. **Fresh user registration**: Tests that reference hardcoded emails (`alice@integration.test`) must register a fresh user first.

---

## Acceptance Criteria

1. [ ] `assert_field` in `helpers.sh` unwraps `.data` wrapper
2. [ ] All `register()`/`login()` assertions check for non-empty token (not JSON parsing)
3. [ ] `agent_lifecycle.test.sh` uses `/tickets/:id/pickup` and `/tickets/:id/release`
4. [ ] `status_transitions.test.sh` uses correct `/api/v1/` paths
5. [ ] `bash backend/integration-test/run.sh --only` passes: 109 tests, 0 failures
6. [ ] `npm test` (Jest) still passes: 1034 tests, 0 failures
7. [ ] No new lint errors introduced in changed files

---

## Out of Scope

- Cypress component test failures (3 of 6 specs failing) — pre-existing UI test issues
- Frontend typecheck errors (9 errors) — pre-existing TypeScript issues
- Frontend lint errors (32 errors) — pre-existing code quality issues
- Creating new backend API endpoints — all needed endpoints exist

---

## Performance Considerations

- No performance impact expected. These are test infrastructure fixes.

---

## Security Considerations

- No security impact. These are test-only changes.

---

## Testing Checklist

### Integration Tests
- [ ] `bash backend/integration-test/run.sh --only` — all 109 tests pass
- [ ] Each previously failing suite now passes

### Regression Tests
- [ ] `npm test` — Jest unit tests still pass (1034 tests)
- [ ] `npm run lint` — no new lint errors in changed files

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be fixed** — modify helpers.sh and test suites in place
- ❌ **Changing business logic** — these are test infrastructure fixes only
- ❌ **Adding new dependencies** — no new packages needed

---

*Fill in all sections before starting implementation.*
