#!/usr/bin/env bash
# Frontend API proxy tests
source "$ROOT/integration-test/helpers.sh"

test_frontend_api_proxy() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Frontend API Proxy"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Proxy Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local ticket_body
  ticket_body=$(curl_sf -X POST "http://localhost:3000/api/v1/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"projectId\":\"$proj_id\",\"title\":\"Proxy Test Ticket\",\"description\":\"Test via frontend proxy\"}")
  assert_has_field "Create ticket via frontend proxy returns id" "id" "$ticket_body"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local list_body
  list_body=$(curl_sf "http://localhost:3000/api/v1/projects/$proj_id/tickets" \
    -H "Authorization: Bearer $token")
  assert_has_field "List tickets via frontend proxy returns array" "id" "$list_body"

  if echo "$list_body" | grep -q "\"id\":\"$ticket_id\""; then
    pass "Ticket created via proxy appears in list"
  else
    fail "Ticket via proxy" "created ticket not found in list"
  fi

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:3000/api/v1/projects")
  assert_status "Unauthenticated request via proxy returns 401" "401" "$code"
}
