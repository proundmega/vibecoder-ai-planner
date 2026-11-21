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
  local member2_id
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

  # Runtime pickup is grant-scoped after the clean cut: the node credential
  # authenticates the host, X-Agent-Runtime selects the worker, and an active
  # (node, project, role) grant authorizes the ticket.
  local node_body enrollment_token enroll_body node_id access_token
  local owner_id credential_id model_id runtime_id
  local run_id node_name credential_name model_name
  run_id="$$"
  node_name="FR4 membership node $run_id"
  credential_name="FR4 membership credential $run_id"
  model_name="fr4-membership-model-$run_id"
  owner_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -c \
    "SELECT id FROM users WHERE email='fr4-owner@integration.test';" | tr -d ' ')

  node_body=$(curl_sf -X POST "${BASE}/api/v1/agent-nodes" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $owner_token" \
    -d "{\"name\":\"$node_name\",\"max_uses\":1}")
  enrollment_token=$(echo "$node_body" | jq -r '.data.token // empty')

  enroll_body=$(curl_sf -X POST "${BASE}/api/v1/agent-nodes/enroll" \
    -H "Content-Type: application/json" \
    -d "{\"token\":\"$enrollment_token\",\"name\":\"$node_name\",\"hostname\":\"fr4-node\"}")
  node_id=$(echo "$enroll_body" | jq -r '.data.node.id // empty')
  access_token=$(echo "$enroll_body" | jq -r '.data.access_token // empty')

  if [ -z "$enrollment_token" ] || [ -z "$node_id" ] || [ -z "$access_token" ]; then
    fail "Enrolled FR4 runtime node" "no node id or access token"
    return
  fi
  pass "Enrolled FR4 runtime node"

  credential_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -q -c \
    "INSERT INTO provider_credentials (owner_id, name, provider_type, api_key_encrypted) VALUES ($owner_id, '$credential_name', 'openai', 'x') RETURNING id;" | tr -d ' ')
  model_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -q -c \
    "INSERT INTO provider_models (credential_id, model, source, roles) VALUES ($credential_id, '$model_name', 'manual', ARRAY['worker']) RETURNING id;" | tr -d ' ')
  runtime_id=$(docker_exec_out vibecode-postgres psql -U postgres -d vibecode -t -q -c \
    "INSERT INTO agent_runtimes (node_id, name, role, model_id, status, current_project_id) VALUES ($node_id, 'fr4-worker-$run_id', 'worker', $model_id, 'running', $project_id) RETURNING id;" | tr -d ' ')

  if [ -z "$credential_id" ] || [ -z "$model_id" ] || [ -z "$runtime_id" ]; then
    fail "Created FR4 runtime" "no credential, model or runtime id"
    return
  fi
  pass "Created FR4 runtime"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/tickets/$t_pickup_denied/pickup" \
    -H "X-API-Key: $access_token" \
    -H "X-Agent-Runtime: $runtime_id")
  assert_status "Runtime without a project grant cannot pick up a ticket" "403" "$http_code"

  docker_exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "INSERT INTO agent_node_grants (node_id, project_id, role) VALUES ($node_id, $project_id, 'worker');" \
    >/dev/null 2>&1 || true

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/tickets/$t_pickup_allowed/pickup" \
    -H "X-API-Key: $access_token" \
    -H "X-Agent-Runtime: $runtime_id")
  assert_status "Runtime with an active project grant can pick up a ticket" "200" "$http_code"
}
test_ticket_project_membership
