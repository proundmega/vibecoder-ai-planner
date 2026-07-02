#!/usr/bin/env bash
# User role ticket access tests
source "$ROOT/integration-test/helpers.sh"

test_user_role_ticket_access() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  User Role Ticket Access"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Bob","email":"bob@integration.test","password":"password123"}')
  assert_status "Register regular user" "201" "$code"

  local token
  token=$(login "bob@integration.test" "password123")

  local login_body
  login_body=$(curl -sf -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"bob@integration.test","password":"password123"}')
  local user_role
  user_role=$(echo "$login_body" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)
  assert_field "Default user role is project_admin" "role" "project_admin" "$user_role"

  local admin_token
  admin_token=$(login "alice@integration.test" "password123")
  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Role Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local ticket_body
  ticket_body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"User Role Ticket","description":"Created by regular user"}')
  assert_has_field "Regular user can create tickets" "id" "$ticket_body"

  local list_body
  list_body=$(curl -sf "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Authorization: Bearer $token")
  assert_has_field "Regular user can list tickets" "id" "$list_body"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  local single_body
  single_body=$(curl -sf "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_field "Regular user can get ticket by id" "title" "User Role Ticket" "$(echo "$single_body" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"
}
