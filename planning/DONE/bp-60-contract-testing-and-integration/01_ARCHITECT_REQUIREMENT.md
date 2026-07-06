# 01_ARCHITECT_REQUIREMENT.md — Feature Planning Template

**Status**: planned
**Date created**: 2026-07-04
**Date completed**:
**Author**: AI Assistant
**Scope**: Both
**Priority**: P1
**Effort**: Large

---

## Requirement

The frontend-backend contract is not enforced at any level. The OpenAPI spec generation pipeline is broken (generated JSON has empty paths), response validators exist but are never called, the contract test validates validators rather than real responses, and the bash integration suite — the only thing that actually tests real API responses — is never run in CI and has tooling gaps (no jq, fragile JSON parsing, duplicate HTTP calls, no auto-discovery).

The result: backend changes that alter response shapes, rename fields, or change status codes go undetected until runtime in production. Unit tests pass because they mock the DB — they never catch response-shape drift.

This ticket fixes the tooling gaps so the contract can actually be verified.

---

## Existing Infrastructure Audit

**CRITICAL**: Before planning, audit what already exists. Do NOT create new code if existing code can be extended.

### Backend API Check
- [x] OpenAPI spec: `backend/src/api/openapi-spec.js` — exists, generates 75 paths when run from correct CWD
- [x] JSDoc annotations exist on most routes
- [x] No mechanism validates responses against the spec at runtime or in tests

### Frontend API Client Check
- [x] API client: `frontend/src/api/client.js` — native fetch, no response shape validation
- [x] Validators: `frontend/src/api/validator.ts` — defined, tested, never imported anywhere
- [x] Generated types: `frontend/src/api/generated/` — orphaned, never imported, all fields optional

### Bash Integration Suite Check
- [x] Runner: `backend/integration-test/run.sh` — works locally, not in CI
- [x] Helpers: `backend/integration-test/helpers.sh` — fragile JSON parsing (grep/cut, no jq)
- [x] Suites: 20 `.test.sh` files — hardcoded test list in main(), no auto-discovery
- [x] `register()`/`login()` make duplicate HTTP requests

### Integration Check
- [ ] Frontend API client can call existing backend endpoints — YES, but no shape validation
- [ ] Response shapes match (snake_case vs camelCase) — manually maintained, no automated check
- [ ] Auth tokens are used correctly — YES
- [ ] Error handling matches existing patterns — YES

### Key Insight

This is a **tooling and process** ticket. No new features. Every change makes existing infrastructure actually enforceable.

---

## Scope

### In Scope
1. **Fix OpenAPI spec generation** — The `generate:spec` script produces empty paths because `require('../backend/src/api/openapi-spec')` resolves from the wrong CWD. Fix so `openapi-generated.json` contains real paths.
2. **Wire response validation into the API client** — Make `extractData()` in `client.js` optionally validate response shapes, or at minimum add a runtime check that the `success` field is present and `data` has expected keys.
3. **Improve bash integration test suite tooling** — Install jq, fix `register()`/`login()` to make one request, add auto-discovery of suite files, add `run.sh --list` mode.
4. **Fill critical bash suite coverage gaps** — Add tests for: agent lifecycle (pickup → message → release), X-API-Key agent auth, rate limiter (negative test that request is rejected when rate-limited), file upload for attachments, permission matrix across all 4 roles.

### Out of Scope
- CI integration (separate Jenkins job)
- Full Pact-style contract testing framework (overkill for current scale)
- Converting the bash suite to a proper test framework
- Adding response-shape validation to every API client function (too invasive; focus on the mechanism)
- Frontend E2E tests in Cypress (separate concern)

---

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/api/openapi-generated.json` | REGENERATE | Fix empty paths bug |
| `frontend/src/api/client.js` | MODIFY | Add optional response shape validation in `extractData()` |
| `frontend/src/api/validator.ts` | MODIFY | Add `validateApiResponse` call, export combined validator |
| `frontend/src/api/generated/` | REGENERATE | Types will have real field shapes after spec fix |
| `backend/integration-test/run.sh` | MODIFY | Auto-discovery of suites, `--list` flag |
| `backend/integration-test/helpers.sh` | MODIFY | Use jq, fix register/login duplicate calls |
| `backend/integration-test/suites/agent_lifecycle.test.sh` | CREATE | Full agent pickup→work→release flow |
| `backend/integration-test/suites/agent_auth.test.sh` | CREATE | X-API-Key header tests |
| `backend/integration-test/suites/rate_limiter.test.sh` | CREATE | Rate limit enforcement |
| `backend/integration-test/suites/file_upload.test.sh` | CREATE | Attachment upload via multer |
| `backend/integration-test/suites/permission_matrix.test.sh` | CREATE | All 4 roles × key endpoints |
| `backend/.env.example` | MODIFY | Add PERMISSION_INIT_RETRIES, MAX_POOL_SIZE if missing |
| `config` | NONE | No new env vars |
| `database` | NONE | No migrations |

---

## Known Unknowns

1. **[jq availability]**: Whether jq is pre-installed on target CI environments. If not, the script should install it or handle its absence gracefully.
2. **[Rate limiter test reliability]**: Rate limit windows are time-based; test may be flaky if the window boundary is crossed. Mitigation: use short windows or mock time in the test setup.
3. **[File upload test requires a real file]**: Need to decide whether to generate a temp file in the test or commit a small fixture.

---

## Important Design Decisions

**DECISION POINTS** — Items that need user confirmation. List only items that genuinely need user input.

1. **Validator wiring approach** — Two options: (a) always validate in `extractData()` (always-on, could break if validator doesn't match backend), or (b) validate only in tests (safer, but doesn't protect production). Given the current state, (b) is safer as an incremental step — add `validateAndExtract` as an opt-in in tests, then promote to always-on after a bake-in period.

2. **Rate limiter test window** — The test must hit the rate limit threshold. Options: (a) use a test-specific env var to set a very short window (1s, 2 requests), (b) mock the rate limiter. (a) is more realistic but slower (~2s per test).

If no decisions need user input, write: "No design decisions require user input. All choices follow existing patterns."

---

## Acceptance Criteria

1. [x] [Backend API] `npm run generate:spec` produces an `openapi-generated.json` with non-empty `paths`
2. [x] [Backend API] Generated types compile: `npm run typecheck` passes after regeneration
3. [x] [Backend API] `frontend/src/api/validator.ts` is importable from `client.js` without circular deps
4. [x] [Frontend API] `extractData()` has an optional validation mode configurable per-endpoint
5. [x] [Bash Suite] `register()` and `login()` each make exactly 1 HTTP request (verified by grepping helpers.sh)
6. [x] [Bash Suite] `run.sh` discovers suites automatically (no hardcoded list in main())
7. [x] [Bash Suite] JSON assertions use jq, not grep/cut
8. [x] [Bash Suite] `run.sh --list` prints available suites without running them
9. [x] [Bash Suite] All existing 20 suites still pass with the new tooling
10. [x] [Bash Suite] Agent lifecycle test covers: pickup → verify in_progress → post message → release → verify backlog
11. [x] [Bash Suite] X-API-Key auth test covers: valid key succeeds, invalid key returns 401, missing key returns 401
12. [x] [Bash Suite] Rate limiter test covers: N requests within window succeed, N+1th is rejected with 429
13. [x] [Bash Suite] Permission matrix test covers: user/member/project_admin/super_admin × ticket CRUD + project CRUD
14. [ ] [Both] All tests pass (unit, integration, frontend, lint, typecheck)
15. [ ] [Both] Bash integration suite passes on clean Docker environment
16. [ ] [Both] Specification in `04_SPECIFICATION.md` accurately reflects the implementation

---

## Out of Scope

- CI integration (separate Jenkins job — user explicitly deferred)
- Pact-style contract testing (too heavy)
- Converting bash suite to Python/Go (keep as bash for minimal deps)
- Adding Cypress E2E tests
- Response validation in production (only in test mode for now)

---

## Performance Considerations

- Expected load: N/A — tooling/infra change
- N+1 queries to avoid: N/A
- Caching strategy: N/A
- Pagination needed: N/A

---

## Security Considerations

- [x] Authentication required: NO — bash integration tests use test credentials
- [ ] Authorization check: N/A
- [ ] Input validation: N/A
- [ ] Rate limiting: YES — the rate limiter test explicitly exercises rate limit code
- [ ] Sensitive data handling: YES — X-API-Key tests must not log keys

---

## Testing Checklist

### Backend Tests
- [x] Unit test files CREATED for all new/changed backend code
- [ ] Unit tests: `backend/src/__tests__/` — verify `generate:spec` produces correct output
- [ ] Middleware tests: N/A
- [ ] API endpoint tests: N/A
- [ ] Jest integration tests: N/A
- [x] **Bash integration suite**: test added or extended in `backend/integration-test/suites/` — see AC 9-14
- [ ] Every new controller method has at least one test case
- [ ] Every new service method has at least one test case
- [ ] Every new validator schema has at least one test case
- [x] Happy path AND error paths tested (not just happy path)
- [ ] Code coverage: run `npm run test:coverage` — no significant decrease in changed modules

### Frontend Tests
- [x] Unit test files CREATED for all new/changed frontend code
- [x] Unit tests: `frontend/src/__tests__/` — tests for validator integration with client
- [ ] Component tests: N/A
- [ ] E2E tests: N/A
- [x] API contract tests: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED with new validator scenarios
- [x] Response validation: `frontend/src/api/validator.ts` — MODIFIED to support opt-in validation
- [ ] Every new API client function has at least one test case
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

### CI Requirements
- [x] `npm test` — backend unit tests pass
- [ ] `npm run test:integration` — backend integration tests pass (if applicable)
- [x] `cd backend && bash integration-test/run.sh --only` — bash integration suite passes
- [ ] `npm run lint` — no lint errors
- [x] `npm run typecheck` — frontend typecheck passes
- [x] `npm run build` — frontend build passes

---

## Anti-Patterns to Avoid

- ❌ **Creating new files when existing ones can be extended** — modify `helpers.sh` and `run.sh` rather than rewriting
- ❌ **Duplicating existing patterns** — new bash suites should follow `assert_status`/`assert_field` helpers
- ❌ **Hardcoding API paths** — use the helper functions from `helpers.sh`
- ❌ **Testing only happy paths** — each new suite must test auth failure and validation error paths
- ❌ **No bash integration test for backend changes** — this ticket IS about adding those tests
- ❌ **Response validation not updated** — when `validator.ts` changes, contract tests must update
- ❌ **Generated types stale** — after spec fix, verify types compile and consider importing them
- ❌ **Skipping the Specification file** — if a small model executes parts of this, create `04_SPECIFICATION.md`

---

*Fill in all sections before starting implementation. The existing infrastructure audit is the most important section — it prevents agents from creating redundant code.*
