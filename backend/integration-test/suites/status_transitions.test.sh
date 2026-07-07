#!/usr/bin/env bash
# Ticket status transition tests
source "$ROOT/integration-test/helpers.sh"

test_status_transitions() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Ticket Status Transitions"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Transition Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local ticket_id
  ticket_id=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Transition ticket","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  # backlog → in_progress (valid)
  local body
  body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"in_progress"}')
  assert_field "backlog → in_progress" "status" "in_progress" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  # in_progress → review (valid)
  body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"review"}')
  assert_field "in_progress → review" "status" "review" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  # review → done (valid)
  body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"done"}')
  assert_field "review → done" "status" "done" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  # done → backlog (INVALID)
  local response status_code err_body
  response=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"backlog"}')
  status_code=$(echo "$response" | tail -1)
  err_body=$(echo "$response" | sed '$d')
  if [ "$status_code" = "400" ] || [ "$status_code" = "403" ] || echo "$err_body" | grep -qi "invalid\|forbidden\|not allowed"; then
    pass "done → backlog rejected"
  else
    fail "done → backlog" "expected 400/403, got $status_code: $err_body"
  fi

  # in_progress → done (INVALID — must go through review first)
  local ticket2_id
  ticket2_id=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Skip review ticket","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  curl -s -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket2_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"in_progress"}' >/dev/null 2>&1

  response=$(curl -s -w "\n%{http_code}" -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket2_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"status":"done"}')
  status_code=$(echo "$response" | tail -1)
  err_body=$(echo "$response" | sed '$d')
  if [ "$status_code" = "400" ] || [ "$status_code" = "403" ] || echo "$err_body" | grep -qi "invalid\|forbidden\|not allowed"; then
    pass "in_progress → done rejected"
  else
    fail "in_progress → done" "expected 400/403, got $status_code: $err_body"
  fi
}
