#!/usr/bin/env bash
# X-API-Key header authentication tests
source "$ROOT/integration-test/helpers.sh"

test_agent_auth() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Agent Auth (X-API-Key)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local user_token api_key

  # Register and login as project admin
  user_token=$(register "Auth User" "auth@test.com" "password123" "project_admin")
  assert_has_field "Register auth user" "token" "{\"token\":\"$user_token\"}"

  # Create a project
  local proj_body project_id
  proj_body=$(curl -sf "$BASE/api/v1/projects" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"Auth Project","description":"For testing agent auth"}')
  project_id=$(echo "$proj_body" | jq -r '.id // empty')

  # Get agent's API key by creating an agent
  local agent_body
  agent_body=$(curl -sf "$BASE/api/v1/agents" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"Test Agent"}')
  api_key=$(echo "$agent_body" | jq -r '.api_key // empty')

  # Test 1: Valid X-API-Key should not return 401
  local code_valid
  code_valid=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/test-agent-id/pickup" \
    -H "X-API-Key: $api_key" \
    -H "Content-Type: application/json" \
    -d '{"ticket_id":"dummy"}')
  # Agent endpoint may return 403/404 if agent doesn't exist, but auth should pass (not 401)
  if [ "$code_valid" != "401" ]; then
    pass "Valid X-API-Key accepted (HTTP $code_valid)"
  else
    fail "Valid X-API-Key" "returned 401 instead of being accepted"
  fi

  # Test 2: Invalid X-API-Key should return 401
  local code_invalid
  code_invalid=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/test-agent-id/pickup" \
    -H "X-API-Key: invalid-key-12345" \
    -H "Content-Type: application/json" \
    -d '{"ticket_id":"dummy"}')
  assert_status "Invalid X-API-Key returns 401" "401" "$code_invalid"

  # Test 3: Missing X-API-Key should return 401
  local code_missing
  code_missing=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/test-agent-id/pickup" \
    -H "Content-Type: application/json" \
    -d '{"ticket_id":"dummy"}')
  assert_status "Missing X-API-Key returns 401" "401" "$code_missing"

  # Test 4: Empty X-API-Key should return 401
  local code_empty
  code_empty=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/test-agent-id/pickup" \
    -H "X-API-Key: " \
    -H "Content-Type: application/json" \
    -d '{"ticket_id":"dummy"}')
  assert_status "Empty X-API-Key returns 401" "401" "$code_empty"

  # Test 5: X-API-Key works for ticket creation
  local create_code
  create_code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/test-agent-id/tickets/create" \
    -H "X-API-Key: $api_key" \
    -H "Content-Type: application/json" \
    -d "{\"project_id\":\"$project_id\",\"title\":\"Agent Created Ticket\",\"description\":\"Created by agent\"}")
  # Should not be 401 (may be 403/404 for other reasons)
  if [ "$create_code" != "401" ]; then
    pass "X-API-Key accepted for ticket creation (HTTP $create_code)"
  else
    fail "X-API-Key for ticket creation" "returned 401"
  fi
}
