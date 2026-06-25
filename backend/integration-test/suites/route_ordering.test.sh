#!/usr/bin/env bash
# Route ordering tests
source "$ROOT/integration-test/helpers.sh"

test_route_ordering() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Route Ordering"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Route Order Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Route order ticket","description":""}' >/dev/null 2>&1

  local tickets_body
  tickets_body=$(curl -sf "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Authorization: Bearer $token")
  if echo "$tickets_body" | grep -q '"title"'; then
    pass "GET /projects/:id/tickets returns tickets array"
  else
    fail "Route ordering" "GET /projects/:id/tickets did not return tickets"
  fi

  local proj_body
  proj_body=$(curl -sf "${BASE}/api/v1/projects/$proj_id" \
    -H "Authorization: Bearer $token")
  if echo "$proj_body" | grep -q '"name"'; then
    pass "GET /projects/:id returns project details"
  else
    fail "Route ordering" "GET /projects/:id did not return project details"
  fi
}
