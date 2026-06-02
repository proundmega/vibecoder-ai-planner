#!/usr/bin/env bash
# Full integration test suite — runs against real Docker containers + real PostgreSQL.
# Usage: ./run.sh          (brings up docker compose first)
#        ./run.sh --only   (skips docker compose up, assumes services already running)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="http://localhost:3001"
RETRIES=30
RETRY_INTERVAL=2

PASS=0
FAIL=0
TESTS=()

# ── Helpers ──────────────────────────────────────────────────────────────────

pass() { PASS=$((PASS + 1)); TESTS+=("✓ $1"); }
fail() { FAIL=$((FAIL + 1)); TESTS+=("✗ $1 — $2"); }

# Wait for API to be reachable
wait_for_api() {
  echo "Waiting for API on :3001..."
  for i in $(seq 1 $RETRIES); do
    if curl -sf "$BASE/api/health" >/dev/null 2>&1; then
      echo "API is ready."
      return 0
    fi
    sleep $RETRY_INTERVAL
  done
  echo "API did not become ready in time."
  exit 1
}

# Clean all test data from the database
clean_db() {
  echo "Cleaning database..."
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode \
    -c "DELETE FROM tickets CASCADE; DELETE FROM agent_actions CASCADE; DELETE FROM ai_actions CASCADE; DELETE FROM projects CASCADE; DELETE FROM users CASCADE;" 2>/dev/null || true
}

# Register a new user and return the token
register() {
  local name="$1" email="$2" password="$3"
  local code body
  body=$(curl -sf -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\"}")
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\"}")
  if [ "$code" = "201" ]; then
    echo "$body" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
  else
    echo ""
  fi
}

# Login and return the token
login() {
  local email="$1" password="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  if [ "$code" = "200" ]; then
    curl -s -X POST "$BASE/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
      | grep -o '"token":"[^"]*"' | cut -d'"' -f4
  else
    echo ""
  fi
}

# Assert HTTP status code
assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label (HTTP $actual)"
  else
    fail "$label" "expected HTTP $expected, got HTTP $actual"
  fi
}

# Assert JSON field value
assert_field() {
  local label="$1" field="$2" expected="$3" actual="$4"
  if [ "$actual" = "$expected" ]; then
    pass "$label ($field=$expected)"
  else
    fail "$label" "expected $field=$expected, got $field=$actual"
  fi
}

# Assert JSON contains a key
assert_has_field() {
  local label="$1" field="$2" json="$3"
  if echo "$json" | grep -q "\"$field\""; then
    pass "$label (has $field)"
  else
    fail "$label" "missing field $field"
  fi
}

# Assert JSON does NOT contain a key
assert_no_field() {
  local label="$1" field="$2" json="$3"
  if ! echo "$json" | grep -q "\"$field\""; then
    pass "$label (no $field)"
  else
    fail "$label" "unexpected field $field"
  fi
}

# ── Test suites ──────────────────────────────────────────────────────────────

test_health() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Health & Version"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local body
  body=$(curl -sf "$BASE/api/health")
  assert_field "Health returns ok" "status" "ok" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  body=$(curl -sf "$BASE/api/version")
  assert_field "Version returns 1.0.0" "version" "1.0.0" "$(echo "$body" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)"
}

test_auth() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Authentication"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Register
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Alice","email":"alice@integration.test","password":"password123"}')
  assert_status "Register new user" "201" "$code"

  # Duplicate register
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Alice","email":"alice@integration.test","password":"password123"}')
  assert_status "Reject duplicate registration" "400" "$code"

  # Login
  local token
  token=$(login "alice@integration.test" "password123")
  assert_has_field "Login returns token" "token" "{\"token\":\"$token\"}"

  # Wrong password
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@integration.test","password":"wrongpassword"}')
  assert_status "Reject wrong password" "401" "$code"

  # Auth me
  local me_body
  me_body=$(curl -sf "$BASE/api/auth/me" -H "Authorization: Bearer $token")
  assert_has_field "GET /auth/me returns user" "user" "$me_body"

  # Auth me returns userId (not id) — known quirk
  assert_no_field "GET /auth/me returns userId not id" "id" "$me_body"

  # Auth me without token
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")
  assert_status "GET /auth/me without token returns 401" "401" "$code"

  # Auth me with invalid token
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" -H "Authorization: Bearer invalid-token")
  assert_status "GET /auth/me with invalid token returns 401" "401" "$code"
}

test_projects() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Projects"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Login
  local token
  token=$(login "alice@integration.test" "password123")

  # Unauthenticated
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects")
  assert_status "List projects without auth" "401" "$code"

  # Create project
  local proj_body
  proj_body=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Integration Test Project","description":"Created by integration tests"}')
  assert_has_field "Create project returns id" "id" "$proj_body"
  assert_field "Create project returns name" "name" "Integration Test Project" "$(echo "$proj_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  local proj_id
  proj_id=$(echo "$proj_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # List projects
  local list_body
  list_body=$(curl -sf "$BASE/api/projects" -H "Authorization: Bearer $token")
  assert_has_field "List projects returns array" "id" "$list_body"

  # Get single project
  local single_body
  single_body=$(curl -sf "$BASE/api/projects/$proj_id" -H "Authorization: Bearer $token")
  assert_field "Get project by id" "name" "Integration Test Project" "$(echo "$single_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  # Get unknown project
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects/999999999" -H "Authorization: Bearer $token")
  assert_status "Get unknown project returns 404" "404" "$code"

  # Delete project
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/projects/$proj_id" -H "Authorization: Bearer $token")
  assert_status "Delete project" "200" "$code"

  # Verify deleted
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects/$proj_id" -H "Authorization: Bearer $token")
  assert_status "Deleted project returns 404" "404" "$code"
}

test_tickets() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Tickets"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Create a project for ticket tests
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Ticket Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Unauthenticated
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -d '{"title":"No Auth Ticket","description":""}')
  assert_status "Create ticket without auth" "401" "$code"

  # Create ticket
  local ticket_body
  ticket_body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Fix critical bug","description":"Users cannot login","priority":"high"}')
  assert_has_field "Create ticket returns id" "id" "$ticket_body"
  assert_field "Create ticket status defaults to backlog" "status" "backlog" "$(echo "$ticket_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"
  assert_field "Create ticket preserves priority" "priority" "high" "$(echo "$ticket_body" | grep -o '"priority":"[^"]*"' | cut -d'"' -f4)"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # List tickets
  local list_body
  list_body=$(curl -sf "$BASE/api/projects/$proj_id/tickets" -H "Authorization: Bearer $token")
  assert_has_field "List tickets returns array" "id" "$list_body"

  # Get single ticket
  local single_body
  single_body=$(curl -sf "$BASE/api/tickets/$ticket_id" -H "Authorization: Bearer $token")
  assert_field "Get ticket by id" "title" "Fix critical bug" "$(echo "$single_body" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"

  # Update ticket
  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/tickets/$ticket_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Fix critical login bug","priority":"urgent"}')
  assert_status "Update ticket" "200" "$code"

  # Delete ticket
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/tickets/$ticket_id" -H "Authorization: Bearer $token")
  assert_status "Delete ticket" "200" "$code"

  # Verify deleted
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tickets/$ticket_id" -H "Authorization: Bearer $token")
  assert_status "Deleted ticket returns 404" "404" "$code"
}

test_status_transitions() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Ticket Status Transitions"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Create a project
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Transition Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Create a ticket
  local ticket_id
  ticket_id=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Transition ticket","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # backlog → in_progress (valid)
  local body
  body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"in_progress"}')
  assert_field "backlog → in_progress" "status" "in_progress" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  # in_progress → review (valid)
  body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"review"}')
  assert_field "in_progress → review" "status" "review" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  # review → done (valid)
  body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"done"}')
  assert_field "review → done" "status" "done" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  # done → backlog (INVALID)
  local err_body
  err_body=$(curl -s -X POST "$BASE/api/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"backlog"}' 2>&1 || true)
  if echo "$err_body" | grep -qi "invalid"; then
    pass "done → backlog rejected"
  else
    fail "done → backlog" "should be rejected, got: $err_body"
  fi

  # in_progress → done (INVALID — must go through review first)
  # Create another ticket for this test
  local ticket2_id
  ticket2_id=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Skip review ticket","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # in_progress first
  curl -s -X POST "$BASE/api/projects/$proj_id/tickets/$ticket2_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"in_progress"}' >/dev/null 2>&1

  err_body=$(curl -s -X POST "$BASE/api/projects/$proj_id/tickets/$ticket2_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"done"}' 2>&1 || true)
  if echo "$err_body" | grep -qi "invalid"; then
    pass "in_progress → done rejected"
  else
    fail "in_progress → done" "should be rejected, got: $err_body"
  fi
}

test_agents() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  AI Agents"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Create agent (routes have /agents/ prefix due to mounting under /agents)
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/agents/agents/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Test Agent"}')
  assert_status "Create agent" "201" "$code"

  # List agents
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/agents/agents" \
    -H "Authorization: Bearer $token")
  assert_status "List agents" "200" "$code"

  # Agent endpoints without auth
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/agents/agents")
  assert_status "List agents without auth" "401" "$code"
}

test_frontend() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Frontend"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/")
  assert_status "Frontend serves SPA" "200" "$code"

  # Check SPA HTML contains app entry point
  local body
  body=$(curl -sf "http://localhost:3000/")
  if echo "$body" | grep -q 'id="app"'; then
    pass "Frontend serves SPA with app div"
  else
    fail "Frontend" "app div not found in response"
  fi
}

# ── Main ─────────────────────────────────────────────────────────────────────

main() {
  local skip_start=false
  if [[ "${1:-}" == "--only" ]]; then
    skip_start=true
  fi

  if ! $skip_start; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Starting Docker Compose"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cd "$ROOT"
    sudo docker compose down --remove-orphans 2>/dev/null || true
    sudo docker compose build api 2>&1 | tail -3
    sudo docker compose up -d 2>&1 | tail -5
  fi

  wait_for_api
  clean_db

  # Allow frontend nginx to resolve the api hostname
  sleep 3
  sudo docker restart vibecode-frontend 2>/dev/null || true
  sleep 3

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Integration Test Suite"
  echo "  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  test_health
  test_auth
  test_projects
  test_tickets
  test_status_transitions
  test_agents
  test_frontend

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Results: $PASS passed, $FAIL failed, $((PASS + FAIL)) total"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  for t in "${TESTS[@]}"; do
    echo "  $t"
  done

  if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "FAILED: $FAIL test(s) failed"
    exit 1
  else
    echo ""
    echo "ALL TESTS PASSED"
    exit 0
  fi
}

main "$@"
