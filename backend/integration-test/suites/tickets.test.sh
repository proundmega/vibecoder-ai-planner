#!/usr/bin/env bash
# Ticket CRUD tests

test_tickets() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Tickets"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Ticket Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -d '{"title":"No Auth Ticket","description":""}')
  assert_status "Create ticket without auth" "401" "$code"

  local ticket_body
  ticket_body=$(curl_sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Fix critical bug","description":"Users cannot login","priority":"high"}')
  assert_has_field "Create ticket returns id" "id" "$ticket_body"
  assert_field "Create ticket status defaults to backlog" "status" "backlog" "$(echo "$ticket_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"
  assert_field "Create ticket preserves priority" "priority" "high" "$(echo "$ticket_body" | grep -o '"priority":"[^"]*"' | cut -d'"' -f4)"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local list_body
  list_body=$(curl_sf "${BASE}/api/v1/projects/$proj_id/tickets" -H "Authorization: Bearer $token")
  assert_has_field "List tickets returns array" "id" "$list_body"

  local single_body
  single_body=$(curl_sf "${BASE}/api/v1/tickets/$ticket_id" -H "Authorization: Bearer $token")
  assert_field "Get ticket by id" "title" "Fix critical bug" "$(echo "$single_body" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Fix critical login bug","priority":"urgent"}')
  assert_status "Update ticket" "200" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/tickets/$ticket_id" -H "Authorization: Bearer $token")
  assert_status "Delete ticket" "200" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/tickets/$ticket_id" -H "Authorization: Bearer $token")
  assert_status "Deleted ticket returns 404" "404" "$code"
}
test_tickets
