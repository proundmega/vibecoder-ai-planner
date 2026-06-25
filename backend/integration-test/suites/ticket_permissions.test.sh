#!/usr/bin/env bash
# Role-based ticket permission tests
source "$ROOT/integration-test/helpers.sh"

test_role_based_ticket_permissions() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Role-Based Ticket Permissions"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local admin_token
  admin_token=$(login "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Ticket Permissions Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  curl -sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Member","email":"perm_member@integration.test","password":"password123","role":"member"}' >/dev/null 2>&1

  curl -sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"User","email":"perm_user@integration.test","password":"password123","role":"user"}' >/dev/null 2>&1

  local ticket_body
  ticket_body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"Member Delete Ticket","description":"Test"}')
  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local member_token
  member_token=$(login "perm_member@integration.test" "password123")
  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/projects/tickets/$ticket_id" \
    -H "Authorization: Bearer $member_token")
  assert_status "Member can delete tickets" "200" "$delete_code"

  ticket_body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"Owned Ticket","description":"Test"}')
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local user_token
  user_token=$(login "perm_user@integration.test" "password123")
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/projects/tickets/$ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_status "User role cannot delete others' tickets" "403" "$delete_code"

  local own_ticket_body
  own_ticket_body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $user_token" \
    -d '{"title":"My Ticket","description":"Test"}')
  local own_ticket_id
  own_ticket_id=$(echo "$own_ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/projects/tickets/$own_ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_status "User role can delete own tickets" "200" "$delete_code"
}
