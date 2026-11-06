#!/usr/bin/env bash
# Project-membership authorization for ticket writes (bp-133 FR4)

test_ticket_project_membership() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Ticket Project Membership (bp-133 FR4)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local owner_token member_token member2_token admin_token user_token
  owner_token=$(seed_user "fr4-owner@integration.test" "password123" "project_admin")
  member_token=$(seed_user "fr4-member@integration.test" "password123" "member")
  member2_token=$(seed_user "fr4-member2@integration.test" "password123" "member")
  admin_token=$(seed_user "fr4-admin@integration.test" "password123" "project_admin")
  user_token=$(seed_user "fr4-user@integration.test" "password123" "user")

  local project_id
  project_id=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $owner_token" \
    -d '{"name":"FR4 Membership Project","description":""}' | jq -r '.data.id // .id')

  create_ticket() {
    curl_sf -X POST "${BASE}/api/v1/projects/$project_id/tickets" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $owner_token" \
      -d "{\"title\":\"$1\",\"description\":\"fr4\"}" | jq -r '.data.id // .id'
  }

  local t_update t_delete t_owner t_pickup_denied t_pickup_allowed
  t_update=$(create_ticket "FR4 update ticket")
  t_delete=$(create_ticket "FR4 delete ticket")
  t_owner=$(create_ticket "FR4 owner ticket")
  t_pickup_denied=$(create_ticket "FR4 pickup denied")
  t_pickup_allowed=$(create_ticket "FR4 pickup allowed")

  local http_code

  # Non-member cannot write another project's ticket.
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$t_update" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $member_token" \
    -d '{"title":"hijacked"}')
  assert_status "Non-member cannot update a ticket" "403" "$http_code"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/tickets/$t_delete" \
    -H "Authorization: Bearer $member_token")
  assert_status "Non-member cannot delete a ticket" "403" "$http_code"

  # Project owner and admin bypass still work.
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$t_update" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $owner_token" \
    -d '{"title":"owner updated"}')
  assert_status "Project owner can update a ticket" "200" "$http_code"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$t_update" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"admin updated"}')
  assert_status "Project admin bypasses the membership check" "200" "$http_code"

  # An active project member can update and delete.
  local member_id member2_id
  member_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -c \
    "SELECT id FROM users WHERE email='fr4-member@integration.test';" | tr -d ' ')
  member2_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -c \
    "SELECT id FROM users WHERE email='fr4-member2@integration.test';" | tr -d ' ')

  docker_exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "INSERT INTO project_memberships (project_id, user_id) VALUES ($project_id, $member2_id) ON CONFLICT DO NOTHING;" \
    >/dev/null 2>&1 || true

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$t_update" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $member2_token" \
    -d '{"title":"member updated"}')
  assert_status "Active project member can update a ticket" "200" "$http_code"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/tickets/$t_delete" \
    -H "Authorization: Bearer $member2_token")
  assert_status "Active project member can delete a ticket" "200" "$http_code"

  # The ticket owner can still write their own ticket without a membership row.
  local owned_ticket
  owned_ticket=$(curl_sf -X POST "${BASE}/api/v1/projects/$project_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $user_token" \
    -d '{"title":"FR4 user-owned ticket","description":"fr4"}' | jq -r '.data.id // .id')

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PUT "${BASE}/api/v1/tickets/$owned_ticket" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $user_token" \
    -d '{"title":"user updated own ticket"}')
  assert_status "Ticket owner can update their own ticket" "200" "$http_code"

  # Agent pickup is scoped to the agent owner's project access.
  local agent_body agent_key agent_id
  agent_body=$(curl_sf -X POST "${BASE}/api/v1/agents/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $owner_token" \
    -d '{"name":"FR4 membership agent"}')
  agent_key=$(echo "$agent_body" | jq -r '.generatedApiKey // .api_key // empty')
  agent_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -c \
    "SELECT id FROM agents WHERE name='FR4 membership agent' ORDER BY id DESC LIMIT 1;" | tr -d ' ')

  if [ -z "$agent_key" ] || [ -z "$agent_id" ]; then
    fail "Created FR4 agent" "no api key or id"
    return
  fi
  pass "Created FR4 agent"

  docker_exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "UPDATE agents SET owner_id = $member_id WHERE id = $agent_id;" >/dev/null 2>&1 || true

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/tickets/$t_pickup_denied/pickup" \
    -H "X-API-Key: $agent_key")
  assert_status "Agent owned by a non-member cannot pick up a ticket" "403" "$http_code"

  docker_exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "UPDATE agents SET owner_id = $member2_id WHERE id = $agent_id;" >/dev/null 2>&1 || true

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/tickets/$t_pickup_allowed/pickup" \
    -H "X-API-Key: $agent_key")
  assert_status "Agent owned by a project member can pick up a ticket" "200" "$http_code"
}
test_ticket_project_membership
