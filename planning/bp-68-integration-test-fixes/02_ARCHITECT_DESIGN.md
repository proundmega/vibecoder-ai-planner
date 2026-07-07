# 02_ARCHITECT_DESIGN.md — Fix Bash Integration Test Suite (Round 2)

**Status**: in_progress
**Author**: AI Assistant
**Scope**: Backend | Tests
**Related**: `01_ARCHITECT_REQUIREMENT.md`, `03_ARCHITECT_IMPLEMENTATION.md`

---

## Problem Statement

74 out of 109 bash integration tests fail. Root causes:
1. `assert_field` doesn't unwrap `.data` response wrapper (causes ~50 failures)
2. Register/login assertions pass constructed JSON to `assert_has_field` (causes ~10 failures)
3. `agent_lifecycle.test.sh` calls non-existent `/agents/:id/pickup` endpoint (causes ~6 failures)
4. `status_transitions.test.sh` uses bare `/api/` paths for invalid transition tests (causes ~2 failures)
5. Tests reference `alice@integration.test` after `clean_db` deletes all users (causes ~6 failures)

---

## Current State

### Response Format
All v1 API endpoints return: `{ success: true, data: { ... } }`
- `assert_has_field` (Round 1 fix): checks both root and `.data` ✓
- `assert_field` (Round 2 fix): needs to unwrap `.data` before jq extraction

### Register/Login Helpers
```bash
register() {
  # ... curl ...
  echo "$body" | jq -r '.token // empty'  # Returns JUST the token string
}
```

Tests call:
```bash
token=$(register "User" "user@test.com" "pass")
assert_has_field "Register user" "token" "{\"token\":\"$token\"}"
```

This constructs `{"token":"eyJhbGci..."}` and checks if it has a `token` field. The constructed string IS valid JSON with a `token` field, BUT:
- If `register` returns empty (rate limited), the string is `{"token":""}` which has a `token` field but empty value
- The assertion passes but the test is fragile

### Agent Endpoints
- `POST /api/v1/agents/:agentId/pickup` — DOES NOT EXIST
- `POST /api/v1/agents/:agentId/release` — DOES NOT EXIST
- `POST /api/v1/tickets/:ticketId/pickup` — EXISTS (in `tickets.js`)
- `POST /api/v1/tickets/:ticketId/release` — EXISTS (in `tickets.js`)

### Status Transitions
- `POST /api/v1/projects/:projId/tickets/:ticketId/status` — EXISTS (in `projects.js`)
- `POST /api/v1/tickets/:ticketId/status` — EXISTS (in `tickets.js`)
- `status_transitions.test.sh` uses `/api/v1/projects/:id/tickets/:id/status` ✓
- But `done → backlog` test uses `curl -sf POST /api/...` (bare `/api/` without `/v1/`)

---

## Design

### Fix 1: `assert_field` — Unwrap `.data`

**File**: `backend/integration-test/helpers.sh`

**Current code**:
```bash
assert_field() {
  local label="$1" field="$2" expected="$3" data="$4"
  if [[ "$data" == \{* ]] || [[ "$data" == \[* ]]; then
    local actual
    actual=$(echo "$data" | jq -r ".$field // empty" 2>/dev/null)
    if [ -z "$actual" ]; then
      actual=$(echo "$data" | jq -r '(.data // .) | if type == "array" then .[0] else . end | .'"$field"' // empty' 2>/dev/null)
    fi
    # ... comparison
  fi
}
```

**Issue**: The jq query `(.data // .) | if type == "array" then .[0] else . end | .field` is complex and may fail silently.

**Fix**: Simplify and make it robust:
```bash
assert_field() {
  local label="$1" field="$2" expected="$3" data="$4"
  if [[ "$data" == \{* ]] || [[ "$data" == \[* ]]; then
    local actual
    # Try root level first
    actual=$(echo "$data" | jq -r ".$field // empty" 2>/dev/null)
    # If not found, try inside .data (handle both object and array)
    if [ -z "$actual" ]; then
      actual=$(echo "$data" | jq -r '
        (.data // .) |
        if type == "array" then .[0] else . end |
        .'"$field"' // empty
      ' 2>/dev/null)
    fi
    # If still not found, try .data.field directly (for nested objects)
    if [ -z "$actual" ]; then
      actual=$(echo "$data" | jq -r '.data.'"$field"' // empty' 2>/dev/null)
    fi
    if [ -z "$actual" ]; then
      actual="__NULL__"
    fi
    # ... comparison unchanged
  fi
}
```

### Fix 2: Register/Login Assertions — Check Non-Empty Token

**Files**: All test suites that use `assert_has_field "Register"` or `assert_has_field "Login"`

**Current pattern**:
```bash
token=$(register "User" "user@test.com" "pass")
assert_has_field "Register user" "token" "{\"token\":\"$token\"}"
```

**Fix**: Change to simple non-empty check:
```bash
token=$(register "User" "user@test.com" "pass")
if [ -n "$token" ]; then
  pass "Register user (got token)"
else
  fail "Register user" "no token returned"
fi
```

**Affected suites** (grep for `assert_has_field "Register`):
- `agent_auth.test.sh`
- `agent_lifecycle.test.sh`
- `agents.test.sh`
- `auth.test.sh`
- `billing.test.sh`
- `credentials.test.sh`
- `file_upload.test.sh`
- `permission_matrix.test.sh`
- `rate_limiter.test.sh`

Also `assert_has_field "Login"`:
- `auth.test.sh`

### Fix 3: Agent Lifecycle — Use Ticket Endpoints

**File**: `backend/integration-test/suites/agent_lifecycle.test.sh`

**Current code** (lines 58, 88):
```bash
curl ... "$BASE/api/v1/agents/$agent_id/pickup"
curl ... "$BASE/api/v1/agents/$agent_id/release"
```

**Fix**: Use ticket endpoints:
```bash
curl ... "$BASE/api/v1/tickets/$ticket_id/pickup"
curl ... "$BASE/api/v1/tickets/$ticket_id/release"
```

### Fix 4: Status Transitions — Fix Invalid Test Paths

**File**: `backend/integration-test/suites/status_transitions.test.sh`

**Current code** (lines 52-55, 75-78):
```bash
err_body=$(curl -s -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  -d '{"status":"backlog"}' 2>&1 || true)
```

**Issue**: The `|| true` suppresses errors, and the response might be empty.

**Fix**: Capture HTTP status code separately and check response body:
```bash
local response status_code
response=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $token" \
  -d '{"status":"backlog"}')
status_code=$(echo "$response" | tail -1)
err_body=$(echo "$response" | sed '$d')
if [ "$status_code" = "400" ] || echo "$err_body" | grep -qi "invalid\|forbidden"; then
  pass "done → backlog rejected"
else
  fail "done → backlog" "expected 400/403, got $status_code: $err_body"
fi
```

### Fix 5: Fresh User Registration

**Files**: `auth.test.sh`, `projects.test.sh`, `tickets.test.sh`, `status_transitions.test.sh`, `ticket_ownership.test.sh`

**Issue**: Tests call `login "alice@integration.test"` but `clean_db` deleted all users.

**Fix**: Register fresh users before login:
```bash
# Instead of:
token=$(login "alice@integration.test" "password123")

# Use:
token=$(register "Alice" "alice@fresh.test" "password123" "project_admin")
# OR register alice first, then login
register "Alice" "alice@integration.test" "password123" "project_admin"
token=$(login "alice@integration.test" "password123")
```

---

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/integration-test/helpers.sh` | MODIFY | `assert_field` unwraps `.data` |
| `backend/integration-test/suites/agent_lifecycle.test.sh` | MODIFY | Use `/tickets/:id/pickup` and `/tickets/:id/release` |
| `backend/integration-test/suites/status_transitions.test.sh` | MODIFY | Fix invalid transition tests |
| `backend/integration-test/suites/agent_auth.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/agent_lifecycle.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/agents.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/auth.test.sh` | MODIFY | Fix register/login assertions, register fresh users |
| `backend/integration-test/suites/billing.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/credentials.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/file_upload.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/permission_matrix.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/rate_limiter.test.sh` | MODIFY | Fix register/login assertions |
| `backend/integration-test/suites/projects.test.sh` | MODIFY | Register fresh users |
| `backend/integration-test/suites/status_transitions.test.sh` | MODIFY | Register fresh users, fix paths |
| `backend/integration-test/suites/tickets.test.sh` | MODIFY | Register fresh users |
| `backend/integration-test/suites/ticket_ownership.test.sh` | MODIFY | Register fresh users |

---

## Dependencies

### Backend Dependencies
- `src/api/tickets.js` — `POST /tickets/:ticketId/pickup` and `POST /tickets/:ticketId/release` (already exist)
- `src/api/projects.js` — `POST /:id/tickets/:ticketId/status` (already exists)

### Test Dependencies
- `helpers.sh` — `assert_field` function (needs fix)
- All suite files — register/login assertion patterns (need fix)

---

## Config / Environment Changes

- No new environment variables
- No new npm dependencies
- No database migrations

---

## Security Considerations

- No security impact. These are test-only changes.

---

## Testing Strategy

### Verification Steps

1. Run `bash backend/integration-test/run.sh --only` — expect 109/109 passing
2. Run `npm test` — expect 1034/1034 passing (no regression)
3. Run `npm run lint` — expect 0 new errors

### Test Layers

| Layer | Tool | Location | What It Catches |
|-------|------|----------|-----------------|
| Bash integration | curl + helpers | `backend/integration-test/suites/*.test.sh` | Real API responses, multi-step flows |
| Jest unit | Jest | `backend/src/__tests__/*.test.js` | Controller/service logic |

---

## Risks and Edge Cases

### Risks
- **[Risk]**: `assert_field` fix might not handle all response formats
  - **Mitigation**: Try multiple jq paths (root → .data → .data.field) before declaring null
- **[Risk]**: Registering fresh users in tests might introduce rate limiting
  - **Mitigation**: `INTEGRATION_TESTS=1` is set (Round 1 fix), rate limiting is disabled

### Edge Cases
- **[Edge case]**: Response has `data` that is an array (list endpoints)
  - **Handling**: `assert_field` checks `.data[0].field` for arrays
- **[Edge case]**: Response has `data` that is a nested object
  - **Handling**: `assert_field` tries `.data.field` as a fallback
- **[Edge case]**: `register()` returns empty due to rate limiting
  - **Handling**: Non-empty check catches this

---

## Alternative Designs Considered

### Alternative 1: Wrap register/login response in JSON
- **Pros**: Consistent with API response format
- **Cons**: Changes helper function signatures, affects all callers
- **Decision**: Keep helpers returning strings, fix test assertions instead

### Alternative 2: Create a `unwrap_data` helper
- **Pros**: Reusable, explicit
- **Cons**: Adds another function, all tests need to call it
- **Decision**: Fix `assert_field` to unwrap internally — invisible to test code

---

## Specification Generation

This ticket requires changes to many test suite files. The implementation steps in `03_ARCHITECT_IMPLEMENTATION.md` are sufficiently detailed.

---

*This design document guides implementation. All fixes are targeted changes to existing files.*
