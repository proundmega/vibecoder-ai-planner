#!/usr/bin/env bash
# Agent lifecycle: pickup → message → release

test_agent_lifecycle() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Agent Lifecycle"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local user_token project_id ticket_id agent_token

  # Register and login user
  user_token=$(register "Lifecycle User" "lifecycle@test.com" "password123" "project_admin")
  if [ -n "$user_token" ]; then
    pass "Register lifecycle user (got token)"
  else
    fail "Register lifecycle user" "no token returned"
  fi

  # Create project
  local proj_body
  proj_body=$(curl_sf "$BASE/api/v1/projects" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"Lifecycle Project","description":"For testing agent lifecycle"}')
  project_id=$(echo "$proj_body" | extract_id)
  if [ -n "$project_id" ]; then pass "Project has id (got $project_id)"; else fail "Project has id" "no id returned"; fi

  # Create ticket in backlog
  local ticket_body
  ticket_body=$(curl_sf "$BASE/api/v1/projects/$project_id/tickets" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"title":"Lifecycle Ticket","description":"Test ticket","status":"backlog"}')
  ticket_id=$(echo "$ticket_body" | extract_id)
  if [ -n "$ticket_id" ]; then pass "Ticket has id (got $ticket_id)"; else fail "Ticket has id" "no id returned"; fi
  assert_field "Ticket status is backlog" "status" "backlog" "$ticket_body"

  # Register a separate user to act as the agent
  local agent_user_token agent_user_id
  agent_user_token=$(register "Agent Actor" "agent-actor@lifecycle.test" "password123" "user")
  # Get agent user's DB id from /auth/me
  local me_body
  me_body=$(curl_sf "$BASE/api/auth/me" \
    -H "Authorization: Bearer $agent_user_token")
  agent_user_id=$(echo "$me_body" | jq -r '.user.id // empty')

  # Create agent record linked to that user
  local agent_body agent_id
  agent_body=$(curl_sf "$BASE/api/v1/agents/create" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Lifecycle Agent\"}")
  agent_id=$(echo "$agent_body" | extract_id)

  # Agent logs in as their user
  agent_token=$(login "agent-actor@lifecycle.test" "password123")

  # Agent picks up ticket
  local pickup_body pickup_code
  pickup_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/tickets/$ticket_id/pickup" \
    -H "Authorization: Bearer $agent_token" \
    -H "Content-Type: application/json" \
    -d "{\"ticket_id\":\"$ticket_id\"}")
  pickup_code=$(echo "$pickup_body" | tail -1)
  assert_status "Agent picks up ticket" "200" "$pickup_code"

  # Verify ticket status changed to in_progress
  local ticket_after
  ticket_after=$(curl_sf "$BASE/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_field "Ticket status is in_progress after pickup" "status" "in_progress" "$ticket_after"

  # Agent posts a message
  local msg_body msg_code
  msg_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/tickets/$ticket_id/messages" \
    -H "Authorization: Bearer $agent_token" \
    -H "Content-Type: application/json" \
    -d '{"messageType":"agent","content":"Agent working on this ticket"}')
  msg_code=$(echo "$msg_body" | tail -1)
  assert_status "Agent posts message" "201" "$msg_code"

  # Verify message exists
  local msg_list
  msg_list=$(curl_sf "$BASE/api/v1/tickets/$ticket_id/messages" \
    -H "Authorization: Bearer $user_token")
  local msg_count
  msg_count=$(echo "$msg_list" | jq '(.data // .) | if type == "array" then length else 0 end' 2>/dev/null)
  if [ -n "$msg_count" ] && [ "$msg_count" -ge 1 ] 2>/dev/null; then
    pass "Ticket has at least 1 message (count=$msg_count)"
  else
    fail "Ticket has at least 1 message" "Expected >= 1, got $msg_count"
  fi

  # Agent releases ticket
  local release_body release_code
  release_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/tickets/$ticket_id/release" \
    -H "Authorization: Bearer $agent_token" \
    -H "Content-Type: application/json" \
    -d "{\"ticket_id\":\"$ticket_id\"}")
  release_code=$(echo "$release_body" | tail -1)
  assert_status "Agent releases ticket" "200" "$release_code"

  # Verify ticket status returned to backlog
  local ticket_final
  ticket_final=$(curl_sf "$BASE/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_field "Ticket status is backlog after release" "status" "backlog" "$ticket_final"
}
test_agent_lifecycle
