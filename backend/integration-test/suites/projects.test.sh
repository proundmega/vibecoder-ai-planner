#!/usr/bin/env bash
# Project CRUD tests
source "$ROOT/integration-test/helpers.sh"

test_projects() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Projects"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects")
  assert_status "List projects without auth" "401" "$code"

  local proj_body
  proj_body=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Integration Test Project","description":"Created by integration tests"}')
  assert_has_field "Create project returns id" "id" "$proj_body"
  assert_field "Create project returns name" "name" "Integration Test Project" "$(echo "$proj_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  local proj_id
  proj_id=$(echo "$proj_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local list_body
  list_body=$(curl_sf "${BASE}/api/v1/projects" -H "Authorization: Bearer $token")
  assert_has_field "List projects returns array" "id" "$list_body"

  local single_body
  single_body=$(curl_sf "${BASE}/api/v1/projects/$proj_id" -H "Authorization: Bearer $token")
  assert_field "Get project by id" "name" "Integration Test Project" "$(echo "$single_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects/999999999" -H "Authorization: Bearer $token")
  assert_status "Get unknown project returns 404" "404" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/projects/$proj_id" -H "Authorization: Bearer $token")
  assert_status "Delete project" "200" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects/$proj_id" -H "Authorization: Bearer $token")
  assert_status "Deleted project returns 404" "404" "$code"
}
