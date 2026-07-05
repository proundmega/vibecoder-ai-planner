#!/usr/bin/env bash
# Agent lifecycle: pickup → message → release
source "$ROOT/integration-test/helpers.sh"

test_agent_lifecycle() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Agent Lifecycle"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local user_token project_id ticket_id agent_token

  # Register and login user
  user_token=$(register "Lifecycle User" "lifecycle@test.com" "password123" "project_admin")
  assert_has_field "Register lifecycle user" "token" "{\"token\":\"$user_token\"}"

  # Create project
  local proj_body
  proj_body=$(curl -sf "$BASE/api/v1/projects" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"Lifecycle Project","description":"For testing agent lifecycle"}')
  project_id=$(echo "$proj_body" | jq -r '.id // empty')
  assert_field "Project has id" "id" "__NULL__" "$project_id" || true

  # Create ticket in backlog
  local ticket_body
  ticket_body=$(curl -sf "$BASE/api/v1/projects/$project_id/tickets" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"title":"Lifecycle Ticket","description":"Test ticket","status":"backlog"}')
  ticket_id=$(echo "$ticket_body" | jq -r '.id // empty')
  assert_field "Ticket has id" "id" "__NULL__" "$ticket_body"
  assert_field "Ticket status is backlog" "status" "backlog" "$ticket_body"

  # Register a separate user to act as the agent
  local agent_user_token agent_user_id
  agent_user_token=$(register "Agent Actor" "agent-actor@lifecycle.test" "password123" "user")
  # Get agent user's DB id from /auth/me
  local me_body
  me_body=$(curl -sf "$BASE/api/auth/me" \
    -H "Authorization: Bearer $agent_user_token")
  agent_user_id=$(echo "$me_body" | jq -r '.user.id // empty')

  # Create agent record linked to that user
  local agent_body agent_id
  agent_body=$(curl -sf "$BASE/api/v1/agents" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"Lifecycle Agent\",\"user_id\":\"$agent_user_id\"}")
  agent_id=$(echo "$agent_body" | jq -r '.id // empty')

  # Agent logs in as their user
  agent_token=$(login "agent-actor@lifecycle.test" "password123")

  # Agent picks up ticket
  local pickup_body pickup_code
  pickup_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/agents/$agent_id/pickup" \
    -H "Authorization: Bearer $agent_token" \
    -H "Content-Type: application/json" \
    -d "{\"ticket_id\":\"$ticket_id\"}")
  pickup_code=$(echo "$pickup_body" | tail -1)
  assert_status "Agent picks up ticket" "200" "$pickup_code"

  # Verify ticket status changed to in_progress
  local ticket_after
  ticket_after=$(curl -sf "$BASE/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_field "Ticket status is in_progress after pickup" "status" "in_progress" "$ticket_after"

  # Agent posts a message
  local msg_body msg_code
  msg_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/tickets/$ticket_id/messages" \
    -H "Authorization: Bearer $agent_token" \
    -H "Content-Type: application/json" \
    -d '{"content":"Agent working on this ticket","sender":"agent"}')
  msg_code=$(echo "$msg_body" | tail -1)
  assert_status "Agent posts message" "201" "$msg_code"

  # Verify message exists
  local msg_list
  msg_list=$(curl -sf "$BASE/api/v1/tickets/$ticket_id/messages" \
    -H "Authorization: Bearer $user_token")
  assert_field "Ticket has at least 1 message" "0" "1" "$msg_list"

  # Agent releases ticket
  local release_body release_code
  release_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/agents/$agent_id/release" \
    -H "Authorization: Bearer $agent_token" \
    -H "Content-Type: application/json" \
    -d "{\"ticket_id\":\"$ticket_id\"}")
  release_code=$(echo "$release_body" | tail -1)
  assert_status "Agent releases ticket" "200" "$release_code"

  # Verify ticket status returned to backlog
  local ticket_final
  ticket_final=$(curl -sf "$BASE/api/v1/tickets/$ticket_id" \
    -H "Authorization: Bearer $user_token")
  assert_field "Ticket status is backlog after release" "status" "backlog" "$ticket_final"
}
