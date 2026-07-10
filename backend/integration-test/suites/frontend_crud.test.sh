#!/usr/bin/env bash
# Ticket CRUD via frontend endpoint tests
source "$ROOT/integration-test/helpers.sh"

test_ticket_crud_via_frontend_endpoint() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Ticket CRUD via Frontend Endpoint"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Frontend CRUD Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local ticket_body
  ticket_body=$(curl_sf -X POST "${BASE}/api/v1/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"projectId\":\"$proj_id\",\"title\":\"Frontend CRUD Ticket\",\"description\":\"Test CRUD via /api/tickets\",\"priority\":\"high\"}")
  assert_has_field "Create ticket via /api/tickets returns id" "id" "$ticket_body"
  assert_field "Create ticket via /api/tickets has status" "status" "backlog" "$(echo "$ticket_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local update_code
  update_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Updated Frontend CRUD Ticket","priority":"urgent"}')
  assert_status "Update ticket via /api/tickets/:id" "200" "$update_code"

  local single_body
  single_body=$(curl_sf "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_field "Updated ticket title" "title" "Updated Frontend CRUD Ticket" "$(echo "$single_body" | grep -o '"title":"[^"]*"' | cut -d'"' -f4)"

  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_status "Delete ticket via /api/tickets/:id" "200" "$delete_code"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $token")
  assert_status "Deleted ticket returns 404" "404" "$code"
}
