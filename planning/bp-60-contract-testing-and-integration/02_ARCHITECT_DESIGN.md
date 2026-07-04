# 02_ARCHITECT_DESIGN.md — Feature Design Specification

**Status**: Working draft
**Author**: AI Assistant
**Scope**: Both
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`, `04_SPECIFICATION.md`

---

## Problem Statement

Three independent failures prevent the frontend-backend contract from being verifiable:

1. **Spec generation yields empty paths** — The `generate:spec` script in `frontend/package.json` does `cd ../backend && node -e "const specs = require('./src/api/openapi-spec'); ..."` but `swagger-jsdoc` resolves its `apis` glob relative to `process.cwd()`, which is the frontend directory at invocation time. The glob `./src/api/*.js` matches nothing from the frontend CWD, producing `paths: {}`.

2. **Response validators exist but are dead code** — `validator.ts` has well-tested `validateUser`, `validateProject`, `validateTicket`, `validateAgent`, and `validateApiResponse` functions. Zero imports across all frontend code. The contract test tests the validators themselves, not actual API responses.

3. **Bash integration suite has tooling debt** — 20 suites provide real API coverage but use fragile `grep | cut` for JSON parsing, make duplicate HTTP requests in helpers, hardcode the test function list, and have significant coverage gaps.

---

## Current State

### Existing Backend
- OpenAPI spec generator: `backend/src/api/openapi-spec.js` — reads JSDoc from `./src/api/*.js` and `./src/api/routes.js`. Works correctly when run from `backend/` directory (75 paths).
- Spec output: `backend/src/api/openapi-generated.json` — checked in with empty paths.

### Existing Frontend
- API client: `frontend/src/api/client.js` — `extractData()` returns `data.data` without validation.
- Validator: `frontend/src/api/validator.ts` — 5 validation functions, never imported.
- Generated types: `frontend/src/api/generated/` — orphaned, all fields optional.

### Existing Bash Suite
- Runner: `backend/integration-test/run.sh` — 200+ lines, hardcodes 20 test function names.
- Helpers: `backend/integration-test/helpers.sh` — 4 assertion functions + register/login/wait_for_api/clean_db.
- Suites: 20 files in `backend/integration-test/suites/`.

### Gap Analysis
- Spec gen bug: `require()` resolves correctly but `swagger-jsdoc` glob is CWD-dependent. Fix: change CWD before requiring, or pass absolute paths to `apis`.
- Dead validators: `validator.ts` is pure functions with no side effects — can be imported from `client.js` without issues, but wiring it in means deciding whether to validate always or opt-in.
- Coverage gaps: agent lifecycle, X-API-Key auth, rate limiter, file upload, permission matrix.

---

## Design

### Option A: Fix Spec Gen + Opt-In Validators + Bash Suite Overhaul (Recommended)

#### Fix 1: Spec Generation CWD Bug

**Root cause**: `swagger-jsdoc` resolves `apis` globs relative to `process.cwd()`. The generated check-in file `backend/src/api/openapi-generated.json` has empty paths because the generation script runs from the frontend directory.

**Fix**: In `backend/package.json`, add a script `"generate:spec": "node -e \"const specs = require('./src/api/openapi-spec'); require('fs').writeFileSync('./src/api/openapi-generated.json', JSON.stringify(specs, null, 2));\""`. Update `frontend/package.json` `generate:spec` to run it from the backend: `"cd ../backend && npm run generate:spec"`.

Or simpler: just change the `cwd` option in the existing `generate:spec` command to spawn in the backend dir. The current approach uses `cd ../backend && node -e "..."` but the `cwd` of the `node -e` process inherits from the shell. `cd ../backend` does change the directory for the `node` process, which means `require('./src/api/openapi-spec')` runs from backend CWD. Let me verify...

Actually, looking again at the command: `cd ../backend && node -e "const specs = require('./src/api/openapi-spec'); require('fs').writeFileSync('./src/api/openapi-generated.json', ...)"`. The `cd ../backend` does change CWD for the `node` process, so `require('./src/api/openapi-spec')` resolves correctly. But `swagger-jsdoc`'s `apis` glob `'./src/api/*.js'` is resolved relative to `process.cwd()`, which is now `backend/`. So it SHOULD match.

Wait — when I tested earlier, I found:
- From frontend: `node -e "const spec = require('../backend/src/api/openapi-spec'); console.log(Object.keys(spec.paths).length);"` → 0
- With `cd ../backend`: `node -e "const spec = require('./src/api/openapi-spec'); console.log(Object.keys(spec.paths).length);"` → 75

So the command `cd ../backend && node -e "..."` should produce 75 paths. But the checked-in file has 0. This means either (a) the command was run from a different state before JSDoc annotations existed, or (b) there's a subtle CWD issue when run from npm (npm might not fully change the CWD for the spawned shell).

**Fix**: Add the script to `backend/package.json` so it's always run from the right directory:
```json
"generate:spec": "node -e \"const specs = require('./src/api/openapi-spec'); require('fs').writeFileSync('./src/api/openapi-generated.json', JSON.stringify(specs, null, 2));\""
```

Then update `frontend/package.json`:
```json
"generate:spec": "cd ../backend && npm run generate:spec"
```

This guarantees the `node` process runs from `backend/`.

#### Fix 2: Opt-In Response Validation

Add `validateAndExtract` to `client.js` that accepts an optional schema validator:

```js
function extractData(response, validator) {
  return response.json().then(data => {
    if (validator) validator(data);
    return data.data !== undefined ? data.data : data;
  });
}
```

The `validator` is a function that throws on mismatch. This keeps it opt-in — existing callers are unaffected, new callers can pass `validateTicketResponse` from `validator.ts`.

Add `validate` option to `get`, `post`, etc.:
```js
export function get(url, options = {}) {
  return apiFetch(url, options).then(res => extractData(res, options.validate))
}
```

This is backwards-compatible: no existing code changes.

#### Fix 3: Bash Suite Tooling Overhaul

**Auto-discovery**: Replace the hardcoded function list in `run.sh` `main()` with:
```bash
for suite in suites/*.test.sh; do
  source "$suite"
  # Convention: suite filename agent_lifecycle.test.sh → test function test_agent_lifecycle
  func_name="test_$(basename "$suite" .test.sh)"
  $func_name
done
```

**jq**: Replace `assert_field`, `assert_has_field`, `assert_no_field` with jq-based versions:
```bash
assert_field() {
  local label="$1" field="$2" expected="$3" json="$4"
  local actual=$(echo "$json" | jq -r "if has(\"$field\") then .$field else \"__MISSING__\" end")
  if [ "$actual" = "__MISSING__" ]; then
    fail "$label" "Field '$field' not found in JSON"
  elif [ "$actual" != "$expected" ]; then
    fail "$label" "Expected $field=$expected, got $actual"
  else
    pass "$label"
  fi
}
```
Note: `jq has()` distinguishes missing fields from JSON `null` — a field with value `null` produces the string `"null"` rather than `"__MISSING__"`. This is correct behavior: the field exists, it's just null. Callers expecting a null value should assert against the string `"null"`.

**Fix register/login**: Change from two `curl` calls to one:
```bash
register() {
  local response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$1\",\"email\":\"$2\",\"password\":\"$3\"}")
  local http_code=$(echo "$response" | tail -1)
  local body=$(echo "$response" | sed '$d')
  echo "$body"  # caller captures this
  return $([ "$http_code" = "201" ])
}
```

**--list flag**: Parse args early, print suite names without executing.

#### Fix 4: New Test Suites

| Suite | Endpoints | Key Assertions |
|-------|-----------|----------------|
| `agent_lifecycle.test.sh` | POST /agents, POST /agents/:id/pickup, POST /messages, POST /agents/:id/release | Status transitions, message creation, release puts ticket back to backlog |
| `agent_auth.test.sh` | POST /agents/tickets/create with X-API-Key | Valid key succeeds, invalid key 401, missing key 401 |
| `rate_limiter.test.sh` | POST /auth/login (short window) | N requests pass, N+1th gets 429 with Retry-After header |
| `file_upload.test.sh` | POST /tickets/:id/attachments | File upload succeeds, response has filename/content_type, stored_path NOT in response |
| `permission_matrix.test.sh` | Various endpoints × 4 roles | user can't delete others' tickets, member can, project_admin can create projects, super_admin can access all |

### Option B: Pact-Style Contract Testing

Full consumer-driven contract testing with Pact. Each frontend API client generates a contract, verified against the backend.

**Pros**: Industry standard, catches every mismatch, generates type stubs.
**Cons**: Heavy infra (Pact broker), steep learning curve, overkill for current scale (1 frontend, 1 backend).
**Decision**: Option A is better — fixes the actual broken pipeline without introducing a new framework.

### Option C: Always-On Runtime Validation

Make `extractData()` always validate responses using the OpenAPI spec.

**Pros**: Catches mismatches in dev immediately.
**Cons**: Brittle — spec may not cover all response shapes; validation failures in production are confusing.
**Decision**: Option A with opt-in is safer — turn it on per-endpoint as specs stabilize.

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/package.json` | MODIFY | Add `generate:spec` script |
| `frontend/package.json` | MODIFY | Change `generate:spec` to delegate to backend |
| `backend/src/api/openapi-generated.json` | REGENERATE | Will have real paths |
| `frontend/src/api/client.js` | MODIFY | Add optional `validator` param to `extractData` and exported functions |
| `frontend/src/api/validator.ts` | MODIFY | Add `validateApiResponse` wrapper, ensure no circular deps |
| `frontend/src/__tests__/api-contract.test.ts` | EXTEND | Add tests for opt-in validation mode |
| `frontend/src/__tests__/client.test.ts` | EXTEND | Add tests for validator integration |
| `frontend/src/api/generated/` | REGENERATE | Types will have real shapes |
| `backend/integration-test/run.sh` | MODIFY | Auto-discovery, `--list` flag |
| `backend/integration-test/helpers.sh` | MODIFY | jq-based assertions, fix register/login |
| `backend/integration-test/suites/agent_lifecycle.test.sh` | CREATE | Full agent lifecycle |
| `backend/integration-test/suites/agent_auth.test.sh` | CREATE | X-API-Key header tests |
| `backend/integration-test/suites/rate_limiter.test.sh` | CREATE | Rate limit enforcement |
| `backend/integration-test/suites/file_upload.test.sh` | CREATE | Attachment upload |
| `backend/integration-test/suites/permission_matrix.test.sh` | CREATE | Role × endpoint matrix |

---

## Data Flow Diagram

### Fix 1: Spec Generation
```
npm run generate:spec (frontend)
  → cd ../backend && npm run generate:spec
    → node -e "require('./src/api/openapi-spec'); writeFileSync(...)"
      → swagger-jsdoc reads JSDoc from backend/src/api/*.js (CWD=backend/)
        → writes openapi-generated.json with 75 paths
  → cd ../frontend && npm run generate:api
    → openapi-typescript-codegen reads openapi-generated.json
      → generates typed models in frontend/src/api/generated/
```

### Fix 2: Opt-In Validation Flow
```
Frontend store/component:
  get('/api/v1/tickets/123', { validate: validateTicketResponse })
    → apiFetch() sends HTTP request
    → extractData(response, validateTicketResponse)
      → response.json() → parsed body
      → validateTicketResponse(parsed) → throws if shape mismatch
      → return data.data (strips envelope)
```

### Fix 3: Bash Suite Flow
```
bash integration-test/run.sh
  → source suites/*.test.sh (auto-discovered)
  → for each suite:
      → register test user → get JWT
      → call API endpoints with curl
      → assert with jq-based helpers
      → pass/fail per assertion
  → aggregate PASS/FAIL/ERROR
```

### Error Handling Strategy

| Layer | Error Type | Response |
|-------|-----------|----------|
| `extractData` with validator | Response shape mismatch | Throws `Error("Response validation failed: field X missing")` |
| `register()` helper | Registration fails | Returns empty string, caller checks for empty |
| `login()` helper | Login fails | Returns empty string, caller checks for empty |
| jq parse failure | Invalid JSON | jq returns non-zero exit, assertion fails with "Failed to parse JSON" |

---

## Dependencies

### Backend Dependencies
- `swagger-jsdoc` — already installed
- `fs` — built-in

### Frontend Dependencies
- None new — all changes use existing imports

### Bash Suite Dependencies
- `jq` — must be installed (add to `docker-compose.yml` api service or check in `run.sh`)

### Cross-Cutting Dependencies
- OpenAPI spec regeneration must happen AFTER backend JSDoc changes
- Generated types regeneration must happen AFTER spec regeneration

---

## Config / Environment Changes

- [ ] No new environment variables
- [ ] No new database migrations
- [ ] No new npm dependencies
- [x] `jq` should be available in test environments (add to Dockerfile or CI runner)

---

## Database Changes

None.

---

## Security Considerations

- [ ] New endpoints require authentication: NO — existing endpoints only
- [ ] New endpoints require specific permissions: NO
- [ ] Input validated against: N/A
- [ ] Rate limiting: YES — new test exercises rate limit code path
- [ ] Sensitive data in responses: YES — X-API-Key tests must avoid logging keys
- [ ] SQL injection protection: N/A

---

## Risks and Edge Cases

### Backend Risks
- **[Risk]**: Spec generation fix exposes real paths but some JSDoc annotations are stale — **Mitigation**: verify regenerated spec matches actual responses before committing

### Frontend Risks
- **[Risk]**: Adding `validator` param to exported functions could cause type issues if callers pass third positional arg — **Mitigation**: use `options` object pattern (backwards-compatible, existing callers don't pass `options`)
- **[Risk]**: Importing `validator.ts` from `client.js` could create circular dependency if validators import from `client` — **Mitigation**: validators must NOT import from `./client`

### Integration Risks
- **[Risk]**: Rate limiter test is time-dependent — **Mitigation**: use `INTEGRATION_TESTS=1` env to set a 2s window with 2-request limit; test sends 3 requests in quick succession within a single second
- **[Risk]**: File upload test creates real files — **Mitigation**: generate temp file in test, clean up in teardown
- **[Risk]**: Auto-discovery may break if a suite file has multiple test functions — **Mitigation**: convention is one test function per file, named `test_$(basename "$file" .test.sh)`

### Edge Cases
- [Edge case: register() returns 400 (duplicate user)]: Helper returns empty string, assertion catches it
- [Edge case: jq not installed]: `run.sh` should check and provide clear error message
- [Edge case: spec file write fails]: `generate:spec` script should exit non-zero
- [Edge case: validator receives null/undefined data]: `validateApiResponse` checks `data` type before accessing fields

---

## Alternative Designs Considered

### Alternative 1: Pact Framework
- **Pros**: Industry standard, automated contract verification
- **Cons**: Heavy infra, requires Pact broker, steep learning curve
- **Decision**: Option A is more pragmatic — the broken pipeline can be fixed with minimal changes

### Alternative 2: Runtime Swagger Validation Middleware
- **Pros**: Catches all mismatches
- **Cons**: Runtime overhead, brittle in production
- **Decision**: Opt-in validation in `extractData` gives same protection without production risk

### Alternative 3: Rewrite Bash Suite in Python
- **Pros**: Better JSON support, test framework
- **Cons**: New dependency, all 20 suites must be rewritten
- **Decision**: Keep bash, fix tooling — installing jq is one command vs. rewriting 2000+ lines

---

## Specification Generation

If a small model (7B–34B) will execute this ticket, the information above should be distilled into `04_SPECIFICATION.md` — a file that specifies exact file paths, imports, function signatures, test expectations, and edge cases. The small model should not need to make any architecture decisions; those are encoded in the Specification.

- [ ] `04_SPECIFICATION.md` has been created with exact file operations for each file
- [ ] Test expectations are specific (not "test it works" but "returns 400 when email is missing")
- [ ] Edge cases are enumerated explicitly
- [ ] Imports and dependencies are listed per file

---

*This design document guides implementation. The "Extend Existing Structure" section is the most important — it tells the agent exactly how to add to what already exists rather than creating new code from scratch.*
