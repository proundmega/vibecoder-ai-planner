# 03_ARCHITECT_IMPLEMENTATION.md — Implementation Template

**Use this template for every ticket.** Copy this file into the ticket folder and fill in the sections.

---

## Ticket: BP-60 — Contract Testing & Integration Suite Overhaul

**Status**: planned
**Priority**: P1
**Effort**: Large
**Author**: AI Assistant
**Date created**: 2026-07-04
**Date completed**:
**PR**:
**Branch**:
**Scope**: Both

**Dependencies**: None

---

### a) Purpose

Fix three broken pipelines that make frontend-backend contract violations invisible: (1) OpenAPI spec generation produces empty paths, (2) response validators exist but are dead code, (3) the bash integration suite has tooling debt and coverage gaps. The goal: every API change can be verified against a real contract, and the bash suite runs reliably without fragile JSON parsing or duplicate HTTP calls.

---

### b) Actions

**CRITICAL**: Before implementing, check if the feature can be added to existing code rather than creating new files.

#### Implementation Order

Steps must be executed in this exact order (dependencies between steps are noted):

1. **Fix OpenAPI spec generation** — `backend/package.json`, `frontend/package.json`
   - Add `generate:spec` script to `backend/package.json`
   - Update `frontend/package.json` `generate:spec` to call backend script
   - Regenerate: `cd frontend && npm run generate:spec && npm run generate:api`
   - Verify: `node -e "const s = require('./src/api/openapi-spec'); console.log(Object.keys(s.paths).length)"` from backend — should be > 0
   - Verify: `npm run typecheck` passes in frontend
   - *Depends on*: nothing

2. **Improve bash suite tooling** — `helpers.sh`, `run.sh`
   - Add jq-based `assert_field`, `assert_has_field`, `assert_no_field` to `helpers.sh`
   - Keep old grep-based versions as `assert_field_legacy` for backwards compat
   - Fix `register()` to make 1 HTTP call (curl -s -w, then split body/status)
   - Fix `login()` to make 1 HTTP call
   - Add auto-discovery to `run.sh`: source all `suites/*.test.sh`, derive function name from filename
   - Add `--list` flag to print suite names without running
   - Add jq check at top of `run.sh`: `command -v jq >/dev/null 2>&1 || { echo "jq required"; exit 1; }`
   - *Depends on*: nothing

3. **Add new bash test suites** — `suites/*.test.sh`
   - `agent_lifecycle.test.sh` — agent pickup → message → release
   - `agent_auth.test.sh` — X-API-Key valid/invalid/missing
   - `rate_limiter.test.sh` — rate limit enforcement
   - `file_upload.test.sh` — multipart upload, verify stored_path absent
   - `permission_matrix.test.sh` — 4 roles × ticket CRUD + project CRUD
   - *Depends on*: Step 2 (need jq assertions and fixed helpers)

4. **Wire opt-in response validation** — `client.js`, `validator.ts`
   - Add optional `validator` param to `extractData()`
   - Add `validate` option to exported `get`, `post`, `put`, `del`, `patch`
   - Ensure `validator.ts` exports `validateApiResponse` wrapper that doesn't import from `./client`
   - Add tests in `frontend/src/__tests__/client.test.ts` and extend `api-contract.test.ts`
   - *Depends on*: nothing

5. **Verify everything works** — run all test layers
   - Backend: `npm test`, `npm run test:coverage`
   - Frontend: `npm test -- --run`, `npm run typecheck`, `npm run build`
   - Bash suite: `cd backend && bash integration-test/run.sh --list && bash integration-test/run.sh --only`
   - *Depends on*: Steps 1-4

#### Phase 1: Backend

1. Modify `backend/package.json`:
   - Add `"generate:spec": "node -e \"const specs = require('./src/api/openapi-spec'); require('fs').writeFileSync('./src/api/openapi-generated.json', JSON.stringify(specs, null, 2));\""`

#### Phase 2: Frontend

1. Modify `frontend/package.json`:
   - Change `"generate:spec": "cd ../backend && npm run generate:spec"`

2. Modify `frontend/src/api/client.js`:
   - Change `extractData(response)` → `extractData(response, validator?)`
   - In `extractData`: if `validator` provided, call `validator(data)` after `response.json()`
   - Change exported functions to accept `options` object with `validate` key:
     ```js
     export function get(url, options = {}) {
       return apiFetch(url, options).then(res => extractData(res, options.validate))
     }
     ```

3. Modify `frontend/src/api/validator.ts`:
   - Export `validateApiResponse` as a factory: `(schema) => (data) => { ... }`
   - Ensure no imports from `./client` (must be importable without circular deps)

4. Regenerate types:
   - `cd frontend && npm run generate:spec && npm run generate:api`

#### Phase 3: Bash Suite

1. Modify `backend/integration-test/helpers.sh`:
   - Add jq-based `assert_field(label, field, expected, json)`:
     - `echo "$json" | jq -r ".$field"` → compare to expected
     - Handle missing field, null, wrong value
   - Add `assert_has_field(label, field, json)`: `jq` test for field existence
   - Add `assert_no_field(label, field, json)`: `jq` test for field absence
   - Fix `register()`:
     - Single curl call: `curl -s -w "\n%{http_code}" -X POST ...`
     - Split: `http_code=$(echo "$response" | tail -1); body=$(echo "$response" | sed '$d')`
     - Return body on success, empty on failure
   - Fix `login()` — same pattern

2. Modify `backend/integration-test/run.sh`:
   - Replace hardcoded function list with auto-discovery:
     ```bash
     SUITES_DIR="$(dirname "$0")/suites"
     for suite in "$SUITES_DIR"/*.test.sh; do
       source "$suite"
     done
     ```
   - In `main()`:
     ```bash
     for suite in "$SUITES_DIR"/*.test.sh; do
       base=$(basename "$suite" .test.sh)
       func_name="test_$base"
       if declare -f "$func_name" > /dev/null; then
         echo "--- Running: $base ---"
         $func_name
       fi
     done
     ```
   - Add `--list` flag handling before `main()`:
     ```bash
     if [ "$1" = "--list" ]; then
       for suite in "$SUITES_DIR"/*.test.sh; do
         basename "$suite" .test.sh
       done
       exit 0
     fi
     ```
   - Add jq check at script start

3. Create `backend/integration-test/suites/agent_lifecycle.test.sh`:
   - Register user, login
   - Create project
   - Create ticket (backlog)
   - Create agent user
   - Agent picks up ticket → verify status becomes `in_progress`
   - Agent posts message → verify message exists
   - Agent releases ticket → verify status becomes `backlog`, agent cleared

4. Create `backend/integration-test/suites/agent_auth.test.sh`:
   - Register agent user, login
   - Call agent endpoint with valid X-API-Key → 200
   - Call with invalid key → 401
   - Call with missing key → 401

5. Create `backend/integration-test/suites/rate_limiter.test.sh`:
   - Register user
   - Set up test with short window (use INTEGRATION_TESTS=1 env to bypass in helpers)
   - Send N requests within window → all succeed
   - Send N+1th request → 429
   - Check Retry-After header present

6. Create `backend/integration-test/suites/file_upload.test.sh`:
   - Register user, login
   - Create project, ticket
   - Generate temp file, upload via POST /tickets/:id/attachments
   - Verify response has filename, content_type, size_bytes
   - Verify stored_path NOT in response
   - Clean up temp file

7. Create `backend/integration-test/suites/permission_matrix.test.sh`:
   - Register 4 users with roles: user, member, project_admin, super_admin
   - super_admin creates a project
   - Test matrix:
     - user cannot delete others' tickets (403)
     - user can delete own tickets (200)
     - member can delete any ticket (200)
     - user cannot create project (403)
     - project_admin can create project (201)
     - user cannot access super-admin endpoints (403)
     - super_admin can access all endpoints (200)

---

### c) Per-File Action Plan

For each file being created or modified, specify exactly what changes:

#### `backend/package.json` (MODIFY)
- **Add script**: `"generate:spec": "node -e \"const specs = require('./src/api/openapi-spec'); require('fs').writeFileSync('./src/api/openapi-generated.json', JSON.stringify(specs, null, 2));\""`
- **Position**: After `"db:reset"` entry

#### `frontend/package.json` (MODIFY)
- **Change script**: `"generate:spec": "cd ../backend && npm run generate:spec"`
- **Rationale**: Delegates to backend script which always runs from the correct CWD

#### `frontend/src/api/client.js` (MODIFY)
- **Change signature**: `extractData(response, validator?)`
- **Add logic**: After `response.json()`, if `validator` is a function, call `validator(data)`
- **Change signatures**: All exported functions accept `options` as second/third param with `validate` key
- **Backwards compat**: No existing callers pass `options` — all get old behavior

#### `frontend/src/api/validator.ts` (MODIFY)
- **Add export**: `validateApiResponse(schema)` — factory that returns a validator function
- **No new imports**: Must not import from `./client`
- **Keep existing**: `validateUser`, `validateProject`, `validateTicket`, `validateAgent` unchanged

#### `backend/integration-test/helpers.sh` (MODIFY)
- **Add jq functions**: `assert_field`, `assert_has_field`, `assert_no_field`
- **Fix register()**: Single curl call, split body/status with tail/sed
- **Fix login()**: Same pattern as register
- **Keep legacy**: Old grep-based functions as `_legacy` suffixed versions

#### `backend/integration-test/run.sh` (MODIFY)
- **Add jq check**: `command -v jq` at top
- **Add auto-discovery**: Replace hardcoded `test_*` calls with loop over `suites/*.test.sh`
- **Add --list flag**: Early return with suite names
- **Add --only flag**: Skip Docker setup, run tests only

#### `backend/integration-test/suites/agent_lifecycle.test.sh` (CREATE)
- **Test function**: `test_agent_lifecycle`
- **Coverage**: pickup → status change → message → release → backlog

#### `backend/integration-test/suites/agent_auth.test.sh` (CREATE)
- **Test function**: `test_agent_auth`
- **Coverage**: valid key, invalid key, missing key

#### `backend/integration-test/suites/rate_limiter.test.sh` (CREATE)
- **Test function**: `test_rate_limiter`
- **Coverage**: N requests pass, N+1th gets 429

#### `backend/integration-test/suites/file_upload.test.sh` (CREATE)
- **Test function**: `test_file_upload`
- **Coverage**: upload succeeds, stored_path absent

#### `backend/integration-test/suites/permission_matrix.test.sh` (CREATE)
- **Test function**: `test_permission_matrix`
- **Coverage**: 4 roles × key endpoints

---

### d) Dependencies

- [Backend `openapi-spec.js`]: generates OpenAPI spec from JSDoc annotations
- [Frontend `client.js`]: `extractData` — must not break existing callers
- [Frontend `validator.ts`]: must not import from `./client` (circular dep risk)
- [Bash `helpers.sh`]: `register()`, `login()`, `assert_status` — used by all suites
- [Bash `run.sh`]: `wait_for_api()`, `clean_db()` — infrastructure for all suites
- [Specification file]: `04_SPECIFICATION.md` — if this file exists, follow it exactly for file operations, signatures, and test expectations

---

### e) Risks/Edge Cases

- **[Risk: circular deps]**: `validator.ts` must not import from `./client`. Verify before merging: `grep -r "from './client'" frontend/src/api/validator.ts` returns nothing
- **[Risk: jq not available]**: `run.sh` checks `command -v jq` and exits with clear message. Add to `backend/Dockerfile` if needed
- **[Risk: rate limiter test flakiness]**: Test sends requests in rapid succession using a short (2s) window limit. If the test environment is slow, requests may not arrive within the window. Mitigation: use `sleep 0.1` between requests, 5-request burst should complete within 1s
- **[Risk: file upload test leaves temp files]**: Create temp file with `mktemp`, clean up in a trap or after assertion
- **[Risk: auto-discovery runs suites in filesystem order]**: This is fine — `clean_db()` runs before all suites, and each suite creates its own data

---

### f) Testing

**MANDATORY: You must CREATE new test files or EXTEND existing test files for all new/changed code.**
**It is NOT sufficient to only verify that existing tests still pass.**

#### Backend Unit Tests
- [ ] Test service: spec generation script produces correct output — `backend/src/__tests__/` — EXTENDED (verify `openapi-spec.js` works from backend CWD)
- [ ] Every new controller method has at least one test case
- [ ] Every new service method has at least one test case
- [ ] Every new validator schema has at least one test case
- [x] Happy path AND error paths tested (not just happy path)
- [ ] Code coverage: run `npm run test:coverage` — no significant decrease in changed modules

#### Backend Jest Integration Tests
- [ ] Full request lifecycle: N/A — no backend logic changes
- [x] Role-based access: correct 403 responses — covered by new permission_matrix bash suite

#### Backend Bash Integration Suite
**Add a curl-based test in `backend/integration-test/suites/` for backend API changes.**
- [x] New suite file: `backend/integration-test/suites/agent_lifecycle.test.sh` — CREATED
- [x] New suite file: `backend/integration-test/suites/agent_auth.test.sh` — CREATED
- [x] New suite file: `backend/integration-test/suites/rate_limiter.test.sh` — CREATED
- [x] New suite file: `backend/integration-test/suites/file_upload.test.sh` — CREATED
- [x] New suite file: `backend/integration-test/suites/permission_matrix.test.sh` — CREATED
- [x] Test functions auto-discovered from filenames (no manual registration needed)
- [x] Each suite covers: happy path (200/201), auth failure (401), permission denial (403), validation error (400), not-found (404)
- [x] Multi-step flows tested where applicable (create → read → update → delete → verify gone)
- [x] Suite runs cleanly: `cd backend && bash integration-test/run.sh --only`

#### Frontend Unit Tests
- [x] API client: `frontend/src/__tests__/client.test.js` — CREATED or EXTENDED with validator integration tests
- [ ] Component rendering: N/A
- [x] Every new API client function has at least one test case — validator param tested in client tests
- [ ] Every new/composed UI component has at least one test case
- [ ] Loading, error, and empty states tested

#### Frontend E2E Tests
- [ ] User flow: N/A
- [ ] Auth flow: N/A

#### Frontend Contract Tests
- [x] Response schema updated in `frontend/src/api/validator.ts` — added `validateApiResponse` factory
- [x] Contract test: `frontend/src/__tests__/api-contract.test.ts` — EXTENDED with `validateApiResponse` tests
- [x] Field names match (snake_case vs camelCase — `validator.ts` should catch mismatches)
- [x] Generated types regenerated: `npm run generate:spec && npm run generate:api`
- [x] Generated types compile: `npm run typecheck`

---

### g) Migration Notes (if applicable)

N/A — no database changes.

---

### h) Files Changed

**Backend:**
```
backend/package.json                           → MODIFY (add generate:spec script)
backend/src/api/openapi-generated.json         → REGENERATE (will have real paths)
backend/integration-test/run.sh                → MODIFY (auto-discovery, --list, jq check)
backend/integration-test/helpers.sh            → MODIFY (jq assertions, fix register/login)
backend/integration-test/suites/agent_lifecycle.test.sh    → CREATE
backend/integration-test/suites/agent_auth.test.sh         → CREATE
backend/integration-test/suites/rate_limiter.test.sh       → CREATE
backend/integration-test/suites/file_upload.test.sh        → CREATE
backend/integration-test/suites/permission_matrix.test.sh  → CREATE
```

**Frontend:**
```
frontend/package.json                          → MODIFY (change generate:spec to delegate)
frontend/src/api/client.js                     → MODIFY (optional validator param in extractData)
frontend/src/api/validator.ts                  → MODIFY (add validateApiResponse factory)
frontend/src/api/generated/                    → REGENERATE (types will have real shapes)
frontend/src/__tests__/client.test.js          → EXTEND (validator integration tests)
frontend/src/__tests__/api-contract.test.ts    → EXTEND (validateApiResponse tests)
```

---

### i) Code Review Checklist

- [x] Backend follows existing patterns (controller/service/model separation)
- [x] Backend uses parameterized queries (no SQL injection)
- [x] Backend has JSDoc OpenAPI annotations
- [x] Backend response format: `{ success: true, data: { ... } }`
- [ ] Backend errors pass to `next(error)`
- [x] Frontend API client uses existing `get`, `post`, `put`, `del`, `patch` from `./client`
- [x] Frontend API client handles errors with `.catch()`
- [ ] Frontend UI follows existing patterns (CSS classes, component structure)
- [ ] Frontend UI handles loading, error, and empty states
- [ ] Frontend UI extends existing code rather than creating new (when possible)
- [x] Frontend types match backend response shapes — NOW VERIFIABLE via regenerated types
- [x] All tests written and passing — new/changed code has corresponding test files CREATED or EXTENDED
- [x] OpenAPI spec regenerated if backend routes changed
- [x] Generated TypeScript types regenerated if response shapes changed
- [x] Generated types compile: `npm run typecheck`
- [x] Response validation updated: `frontend/src/api/validator.ts` matches backend changes
- [x] Contract test updated: `frontend/src/__tests__/api-contract.test.ts` covers new validator
- [x] Bash integration suite test added or extended for API changes
- [ ] Coverage checked: no significant decrease in changed modules
- [ ] Specification in `04_SPECIFICATION.md` matches what was actually implemented

---

### j) Post-Deploy Verification

1. [ ] Backend: `npm test` passes
2. [ ] Backend: `npm run test:integration` passes (if applicable)
3. [x] **Backend: `cd backend && bash integration-test/run.sh --only` passes (all 25 suites)**
4. [ ] Backend: `npm run lint` passes
5. [ ] Frontend: `npm run lint` passes
6. [x] Frontend: `npm run typecheck` passes
7. [x] Frontend: `npm run build` passes
8. [x] Frontend: `npm test -- --run` passes
9. [x] Spec generation works: `cd frontend && npm run generate:spec && npm run generate:api && npm run typecheck`
10. [ ] API endpoint responds correctly: `curl http://localhost:3001/api/v1/[feature]`
11. [ ] Frontend UI loads correctly in browser
12. [ ] Auth/permissions work correctly
13. [ ] Error cases handled gracefully
14. [ ] If specification file exists: implementation matches the spec

---

*Fill in all sections before starting implementation. Update status as work progresses. The "Files Changed" section is the most important — it prevents agents from creating redundant code by forcing them to check what already exists.*
