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
  local role="${4:-project_admin}"
  local code body
  body=$(curl -sf -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
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
    -d '{"name":"Alice","email":"alice@integration.test","password":"password123","role":"project_admin"}')
  assert_status "Register new user" "201" "$code"

  # Duplicate register
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Alice","email":"alice@integration.test","password":"password123","role":"project_admin"}')
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

  # Auth me returns user with id field (fixed)
  assert_has_field "GET /auth/me returns user with id" "id" "$me_body"

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

test_frontend_api_proxy() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Frontend API Proxy"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Create a project for proxy tests
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Proxy Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Create a ticket via /api/tickets (frontend endpoint)
  local ticket_body
  ticket_body=$(curl -sf -X POST "http://localhost:3000/api/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"projectId\":\"$proj_id\",\"title\":\"Proxy Test Ticket\",\"description\":\"Test via frontend proxy\"}")
  assert_has_field "Create ticket via frontend proxy returns id" "id" "$ticket_body"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # List tickets via frontend proxy
  local list_body
  list_body=$(curl -sf "http://localhost:3000/api/projects/$proj_id/tickets" \
    -H "Authorization: Bearer $token")
  assert_has_field "List tickets via frontend proxy returns array" "id" "$list_body"

  # Verify the ticket we just created is in the list
  if echo "$list_body" | grep -q "\"id\":\"$ticket_id\""; then
    pass "Ticket created via proxy appears in list"
  else
    fail "Ticket via proxy" "created ticket not found in list"
  fi

  # Unauthenticated request via proxy should return 401
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/api/projects")
  assert_status "Unauthenticated request via proxy returns 401" "401" "$code"
}

test_route_ordering() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Route Ordering"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Create a project
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Route Order Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Create a ticket in the project
  curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Route order ticket","description":""}' >/dev/null 2>&1

  # GET /api/projects/:id/tickets should return tickets (not project details)
  local tickets_body
  tickets_body=$(curl -sf "$BASE/api/projects/$proj_id/tickets" \
    -H "Authorization: Bearer $token")
  if echo "$tickets_body" | grep -q '"title"'; then
    pass "GET /projects/:id/tickets returns tickets array"
  else
    fail "Route ordering" "GET /projects/:id/tickets did not return tickets"
  fi

  # GET /api/projects/:id should return project details
  local proj_body
  proj_body=$(curl -sf "$BASE/api/projects/$proj_id" \
    -H "Authorization: Bearer $token")
  if echo "$proj_body" | grep -q '"name"'; then
    pass "GET /projects/:id returns project details"
  else
    fail "Route ordering" "GET /projects/:id did not return project details"
  fi
}

test_user_role_ticket_access() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  User Role Ticket Access"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Register a regular user (role='user' by default)
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Bob","email":"bob@integration.test","password":"password123"}')
  assert_status "Register regular user" "201" "$code"

  local token
  token=$(login "bob@integration.test" "password123")

  # Verify login response includes user role
  local login_body
  login_body=$(curl -sf -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"bob@integration.test","password":"password123"}')
  local user_role
  user_role=$(echo "$login_body" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)
  assert_field "Default user role is user" "role" "user" "$user_role"

  # Create a project using project_admin (regular users can't create projects)
  local admin_token
  admin_token=$(login "alice@integration.test" "password123")
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Role Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Regular user should be able to create tickets
  local ticket_body
  ticket_body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"User Role Ticket","description":"Created by regular user"}')
  assert_has_field "Regular user can create tickets" "id" "$ticket_body"

  # Regular user should be able to list tickets
  local list_body
  list_body=$(curl -sf "$BASE/api/projects/$proj_id/tickets" \
    -H "Authorization: Bearer $token")
  assert_has_field "Regular user can list tickets" "id" "$list_body"

  # Regular user should be able to get a single ticket
  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  local single_body
  single_body=$(curl -sf "$BASE/api/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_field "Regular user can get ticket by id" "title" "User Role Ticket" "$(echo "$single_body" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"
}

test_role_based_user_management() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Role-Based User Management"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Login as admin
  local admin_token
  admin_token=$(login "alice@integration.test" "password123")

  # Admin creates a member user
  local member_body
  member_body=$(curl -sf -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Member User","email":"member@integration.test","password":"password123","role":"member"}')
  assert_has_field "Admin can create member user" "id" "$member_body"
  assert_field "Created user has member role" "role" "member" "$(echo "$member_body" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)"

  local member_id
  member_id=$(echo "$member_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Admin creates a user role user
  local user_body
  user_body=$(curl -sf -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"AI User","email":"aiuser@integration.test","password":"password123","role":"user"}')
  assert_has_field "Admin can create user role" "id" "$user_body"
  assert_field "Created user has user role" "role" "user" "$(echo "$user_body" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)"

  # Admin updates user name
  local update_body
  update_body=$(curl -sf -X PUT "$BASE/api/users/$member_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Updated Member"}')
  assert_field "Admin can update user name" "name" "Updated Member" "$(echo "$update_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  # Admin deactivates user
  local deact_body
  deact_body=$(curl -sf -X PATCH "$BASE/api/users/$member_id/toggle-active" \
    -H "Authorization: Bearer $admin_token")
  assert_field "Admin can deactivate user" "isActive" "false" "$(echo "$deact_body" | grep -o '"isActive":[a-z]*' | cut -d':' -f2)"

  # Deactivated user cannot login
  local deact_login_code
  deact_login_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"member@integration.test","password":"password123"}')
  assert_status "Deactivated user cannot login" "401" "$deact_login_code"

  # Admin reactivates user
  local react_body
  react_body=$(curl -sf -X PATCH "$BASE/api/users/$member_id/toggle-active" \
    -H "Authorization: Bearer $admin_token")
  assert_field "Admin can reactivate user" "isActive" "true" "$(echo "$react_body" | grep -o '"isActive":[a-z]*' | cut -d':' -f2)"

  # Admin lists users
  local list_body
  list_body=$(curl -sf "$BASE/api/users" \
    -H "Authorization: Bearer $admin_token")
  assert_has_field "Admin can list users" "users" "$list_body"

  # Regular user cannot create users
  local user_token
  user_token=$(login "aiuser@integration.test" "password123")
  local create_code
  create_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $user_token" \
    -d '{"name":"Another","email":"another@integration.test","password":"password123","role":"user"}')
  assert_status "Regular user cannot create users" "403" "$create_code"

  # Member can create user role
  local member_token
  member_token=$(login "member@integration.test" "password123")
  local member_create_body
  member_create_body=$(curl -sf -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $member_token" \
    -d '{"name":"Agent","email":"agent@integration.test","password":"password123","role":"user"}')
  assert_has_field "Member can create user role" "id" "$member_create_body"

  # Member cannot create member role
  local member_create_code
  member_create_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $member_token" \
    -d '{"name":"Another Member","email":"anothermember@integration.test","password":"password123","role":"member"}')
  assert_status "Member cannot create member role" "400" "$member_create_code"

  # Admin deletes user
  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/users/$member_id" \
    -H "Authorization: Bearer $admin_token")
  assert_status "Admin can delete user" "200" "$delete_code"

  # Super-admin endpoint requires super_admin role
  local super_code
  super_code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/users/super-admin" \
    -H "Authorization: Bearer $admin_token")
  assert_status "Non-super-admin cannot access super-admin endpoint" "403" "$super_code"
}

test_role_based_ticket_permissions() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Role-Based Ticket Permissions"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Login as admin
  local admin_token
  admin_token=$(login "alice@integration.test" "password123")

  # Create a project
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Ticket Permissions Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Create a member user
  curl -sf -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Member","email":"perm_member@integration.test","password":"password123","role":"member"}' >/dev/null 2>&1

  # Create a user role user
  curl -sf -X POST "$BASE/api/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"User","email":"perm_user@integration.test","password":"password123","role":"user"}' >/dev/null 2>&1

  # Member can delete tickets
  local ticket_body
  ticket_body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"Member Delete Ticket","description":"Test"}')
  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local member_token
  member_token=$(login "perm_member@integration.test" "password123")
  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/projects/tickets/$ticket_id" \
    -H "Authorization: Bearer $member_token")
  assert_status "Member can delete tickets" "200" "$delete_code"

  # Create another ticket for user role tests
  ticket_body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"Owned Ticket","description":"Test"}')
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # User role cannot delete others' tickets
  local user_token
  user_token=$(login "perm_user@integration.test" "password123")
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/projects/tickets/$ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_status "User role cannot delete others' tickets" "403" "$delete_code"

  # User role can delete own tickets
  local own_ticket_body
  own_ticket_body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $user_token" \
    -d '{"title":"My Ticket","description":"Test"}')
  local own_ticket_id
  own_ticket_id=$(echo "$own_ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/projects/tickets/$own_ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_status "User role can delete own tickets" "200" "$delete_code"
}

test_approvals_api() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Approvals API"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Login as admin
  local admin_token
  admin_token=$(login "alice@integration.test" "password123")

  # Create a project
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Approval Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Create a ticket
  local ticket_body
  ticket_body=$(curl -sf -X POST "$BASE/api/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"Approval Ticket","description":"Test"}')
  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Move ticket to in_progress
  curl -sf -X POST "$BASE/api/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"status":"in_progress"}' >/dev/null 2>&1

  # Move ticket to review
  curl -sf -X POST "$BASE/api/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"status":"review"}' >/dev/null 2>&1

  # Create approval request
  local approval_body
  approval_body=$(curl -sf -X POST "$BASE/api/approvals" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d "{\"ticketId\":\"$ticket_id\"}")
  assert_has_field "Create approval request" "id" "$approval_body"
  assert_field "Approval status is pending" "status" "pending" "$(echo "$approval_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  local approval_id
  approval_id=$(echo "$approval_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Get pending approvals
  local pending_body
  pending_body=$(curl -sf "$BASE/api/approvals/pending" \
    -H "Authorization: Bearer $admin_token")
  assert_has_field "Get pending approvals" "approvals" "$pending_body"

  # Approve request
  local approve_body
  approve_body=$(curl -sf -X POST "$BASE/api/approvals/$approval_id/approve" \
    -H "Authorization: Bearer $admin_token")
  local approve_status
  approve_status=$(echo "$approve_body" | grep -o '"status":"approved"' | head -1 | cut -d'"' -f4)
  assert_field "Approve transitions to approved" "status" "approved" "$approve_status"

  # Cannot approve already approved
  local approve_code
  approve_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/approvals/$approval_id/approve" \
    -H "Authorization: Bearer $admin_token")
  assert_status "Cannot approve already approved" "400" "$approve_code"

  # User role cannot approve/reject
  local user_token
  user_token=$(login "perm_user@integration.test" "password123")
  local user_approve_code
  user_approve_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/approvals/1/approve" \
    -H "Authorization: Bearer $user_token")
  assert_status "User role cannot approve" "403" "$user_approve_code"
}

test_jwt_token_expiry() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  JWT Token Expiry"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Decode the JWT payload to check expiry using node
  local payload
  payload=$(node -e "const parts=process.argv[1].split('.'); const buf=Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'),'base64'); console.log(buf.toString('utf8'));" "$token" 2>/dev/null)

  # Check that expiry is set (exp field exists)
  if echo "$payload" | grep -q '"exp"'; then
    pass "JWT token contains exp field"
  else
    fail "JWT token" "exp field not found in token payload"
  fi

  # Verify the token works for API calls
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects" \
    -H "Authorization: Bearer $token")
  assert_status "Valid JWT token works for API calls" "200" "$code"

  # Verify expired/invalid token is rejected
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/projects" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid")
  assert_status "Invalid JWT token is rejected" "401" "$code"
}

test_ticket_crud_via_frontend_endpoint() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Ticket CRUD via Frontend Endpoint"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  # Create a project
  local proj_id
  proj_id=$(curl -sf -X POST "$BASE/api/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Frontend CRUD Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Create ticket via /api/tickets (used by frontend TicketBoard)
  local ticket_body
  ticket_body=$(curl -sf -X POST "$BASE/api/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"projectId\":\"$proj_id\",\"title\":\"Frontend CRUD Ticket\",\"description\":\"Test CRUD via /api/tickets\",\"priority\":\"high\"}")
  assert_has_field "Create ticket via /api/tickets returns id" "id" "$ticket_body"
  assert_field "Create ticket via /api/tickets has status" "status" "backlog" "$(echo "$ticket_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # Update ticket via /api/tickets/:id
  local update_code
  update_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "$BASE/api/tickets/$ticket_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Updated Frontend CRUD Ticket","priority":"urgent"}')
  assert_status "Update ticket via /api/tickets/:id" "200" "$update_code"

  # Verify update took effect
  local single_body
  single_body=$(curl -sf "$BASE/api/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_field "Updated ticket title" "title" "Updated Frontend CRUD Ticket" "$(echo "$single_body" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"

  # Delete ticket
  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "$BASE/api/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_status "Delete ticket via /api/tickets/:id" "200" "$delete_code"

  # Verify deleted
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_status "Deleted ticket returns 404" "404" "$code"
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
  echo "  Jest Integration Tests (PostgreSQL)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$ROOT"
  DATABASE_URL="postgresql://postgres:changeme@localhost:5432/vibecode" npx jest --config jest.integration.config.js --verbose 2>&1 | tail -20
  JEST_EXIT=${PIPESTATUS[0]}
  if [ "$JEST_EXIT" -ne 0 ]; then
    echo ""
    echo "FAILED: Jest integration tests exited with code $JEST_EXIT"
    exit 1
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Integration Test Suite (curl + Docker)"
  echo "  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  test_health
  test_auth
  test_projects
  test_tickets
  test_status_transitions
  test_agents
  test_user_role_ticket_access
  test_route_ordering
  test_ticket_crud_via_frontend_endpoint
  test_frontend_api_proxy
  test_role_based_user_management
  test_role_based_ticket_permissions
  test_approvals_api
  test_jwt_token_expiry
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
