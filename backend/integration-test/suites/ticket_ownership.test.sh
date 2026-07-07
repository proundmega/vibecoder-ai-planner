#!/usr/bin/env bash
# Ticket ownership & agent orchestration tests
source "$ROOT/integration-test/helpers.sh"

test_ticket_ownership() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Ticket Ownership & Agent Orchestration (rs-16)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Ownership Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local ticket_body
  ticket_body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"title":"Ownership ticket","description":"Test ticket ownership"}')
  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local agent_id
  agent_id=$(echo "$ticket_body" | grep -o '"assignedAgentId":"[^"]*"' | cut -d'"' -f4 || echo "")
  if [ -z "$agent_id" ]; then
    pass "New ticket has no assigned_agent_id"
  else
    fail "Ticket ownership" "expected no assigned_agent_id, got $agent_id"
  fi

  local agent_email="agent_own_$(date +%s)@integration.test"
  local agent_body
  agent_body=$(curl -sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"name\":\"Test Agent\",\"email\":\"$agent_email\",\"password\":\"password123\",\"role\":\"member\",\"is_agent\":true,\"agent_roles\":[\"worker\"]}")
  local agent_user_id
  agent_user_id=$(echo "$agent_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local agent_token
  agent_token=$(login "$agent_email" "password123")

  local pickup_body
  pickup_body=$(curl -sf -X POST "${BASE}/api/v1/tickets/$ticket_id/pickup" \
    -H "Authorization: Bearer $agent_token")
  assert_has_field "Pickup assigns agent" "assignedAgentId" "$pickup_body"
  assert_field "Pickup sets status to in_progress" "status" "in_progress" "$(echo "$pickup_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  local msg_body
  msg_body=$(curl -sf -X POST "${BASE}/api/v1/tickets/$ticket_id/messages" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $agent_token" \
    -d '{"messageType":"update","content":"Agent started working on this ticket","senderId":"'"$agent_user_id"'"}')
  assert_has_field "Post message returns id" "id" "$msg_body"
  assert_field "Message content preserved" "content" "Agent started working on this ticket" "$(echo "$msg_body" | grep -o '"content":"[^"]*"' | cut -d'"' -f4)"

  local msgs_body
  msgs_body=$(curl -sf "${BASE}/api/v1/tickets/$ticket_id/messages" \
    -H "Authorization: Bearer $agent_token")
  assert_has_field "Get messages returns array" "data" "$msgs_body"

  local release_body
  release_body=$(curl -sf -X POST "${BASE}/api/v1/tickets/$ticket_id/release" \
    -H "Authorization: Bearer $agent_token")
  assert_has_field "Release clears agent assignment" "assignedAgentId" "$release_body"

  local single_body
  single_body=$(curl -sf "${BASE}/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $agent_token")
  assert_field "Released ticket status is backlog" "status" "backlog" "$(echo "$single_body" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)"
}
