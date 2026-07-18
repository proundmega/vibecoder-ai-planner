#!/usr/bin/env bash
# Shared agent memory tests

test_shared_agent_memory() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Shared Agent Memory (rs-19)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Memory Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local agent_body
  agent_body=$(curl_sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d "{\"name\":\"Memory Agent\",\"email\":\"memory_agent_$(date +%s)@integration.test\",\"password\":\"password123\",\"role\":\"member\",\"is_agent\":true,\"agent_roles\":[\"worker\"]}")
  local agent_id
  agent_id=$(echo "$agent_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/memory/project/$proj_id")
  assert_status "Memory without auth returns 401" "401" "$code"

  local mem_body
  mem_body=$(curl_sf -X POST "${BASE}/api/v1/memory/project/$proj_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"content":"The system uses PostgreSQL for data storage","metadata":{"source":"architecture","tags":["database","postgresql"]}}')
  assert_has_field "Add memory returns id" "id" "$mem_body"
  assert_field "Memory content preserved" "content" "The system uses PostgreSQL for data storage" "$(echo "$mem_body" | grep -o '"content":"[^"]*"' | cut -d'"' -f4)"

  local mem_id
  mem_id=$(echo "$mem_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local list_body
  list_body=$(curl_sf "${BASE}/api/v1/memory/project/$proj_id" \
    -H "Authorization: Bearer $token")
  assert_has_field "List project memories returns array" "data" "$list_body"

  local single_body
  single_body=$(curl_sf "${BASE}/api/v1/memory/$mem_id" \
    -H "Authorization: Bearer $token")
  assert_field "Get memory by id" "content" "The system uses PostgreSQL for data storage" "$(echo "$single_body" | grep -o '"content":"[^"]*"' | cut -d'"' -f4)"

  curl_sf -X POST "${BASE}/api/v1/memory/project/$proj_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"content":"The project uses pgvector for semantic search","metadata":{"source":"architecture","tags":["vector","search"]}}' >/dev/null 2>&1

  local search_body
  search_body=$(curl_sf "${BASE}/api/v1/memory/project/$proj_id/search?query=database+storage" \
    -H "Authorization: Bearer $token")
  if echo "$search_body" | grep -q '"data"'; then
    pass "Search returns data field"
  else
    fail "Search" "missing data field"
  fi

  local update_body
  update_body=$(curl_sf -X PUT "${BASE}/api/v1/memory/$mem_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"content":"The system uses PostgreSQL with pgvector extension"}')
  assert_field "Update memory content" "content" "The system uses PostgreSQL with pgvector extension" "$(echo "$update_body" | grep -o '"content":"[^"]*"' | cut -d'"' -f4)"

  local agent_mem_body
  agent_mem_body=$(curl_sf "${BASE}/api/v1/memory/agent/$agent_id" \
    -H "Authorization: Bearer $token")
  assert_has_field "List agent memories returns array" "data" "$agent_mem_body"

  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/memory/$mem_id" \
    -H "Authorization: Bearer $token")
  assert_status "Delete memory" "200" "$delete_code"
}
test_shared_agent_memory
