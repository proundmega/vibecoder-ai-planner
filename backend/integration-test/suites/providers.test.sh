#!/usr/bin/env bash
# Provider route tests
source "$ROOT/integration-test/helpers.sh"

test_providers() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Providers (Global)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "providers@integration.test" "password123" "project_admin" "Provider Test User")

  # --- Create Provider ---
  local body
  body=$(curl -s -X POST "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Integration Provider","providerType":"openai","apiKey":"sk-integration-test-key","model":"gpt-4o","roles":["worker"]}')
  assert_status "Create provider" "201" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_field "Create provider (success)" "success" "true" "$body"
  assert_has_field "Create provider (has id)" "id" "$body"

  local provider_id
  provider_id=$(echo "$body" | jq -r '(.data // .) | .id')

  # --- List Providers ---
  body=$(curl -s "${BASE}/api/v1/providers" \
    -H "Authorization: Bearer $token")
  assert_status "List providers" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_field "List providers (success)" "success" "true" "$body"
  local count
  count=$(echo "$body" | jq '.data | length')
  if [ "$count" -gt 0 ]; then
    pass "List providers (has $count providers)"
  else
    fail "List providers" "expected at least 1 provider"
  fi

  # --- Get Provider by ID ---
  body=$(curl -s "${BASE}/api/v1/providers/$provider_id" \
    -H "Authorization: Bearer $token")
  assert_status "Get provider by ID" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_field "Get provider (name)" "name" "Integration Provider" "$body"

  # --- Get non-existent provider ---
  local http_code
  http_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/providers/999999999" \
    -H "Authorization: Bearer $token")
  assert_status "Get non-existent provider" "404" "$http_code"

  # --- Update Provider ---
  body=$(curl -s -X PATCH "${BASE}/api/v1/providers/$provider_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Updated Provider","model":"gpt-4o"}')
  assert_status "Update provider" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_field "Update provider (name)" "name" "Updated Provider" "$body"

  # --- Update with empty body ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${BASE}/api/v1/providers/$provider_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{}')
  assert_status "Update with empty body" "400" "$http_code"

  # --- Set Director ---
  body=$(curl -s -X PATCH "${BASE}/api/v1/providers/$provider_id/directorship" \
    -H "Authorization: Bearer $token")
  assert_status "Set provider as director" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_field "Set director (is_project_director)" "is_project_director" "true" "$body"

  # --- Test Provider Connection ---
  body=$(curl -s -X POST "${BASE}/api/v1/providers/$provider_id/test" \
    -H "Authorization: Bearer $token")
  assert_status "Test provider connection" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_has_field "Test provider (has message)" "message" "$body"

  # --- Get Provider Agents ---
  body=$(curl -s "${BASE}/api/v1/providers/$provider_id/agents" \
    -H "Authorization: Bearer $token")
  assert_status "Get provider agents" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"

  # --- Resolve Provider ---
  body=$(curl -s -X POST "${BASE}/api/v1/providers/resolve" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"labels":["test"],"priority":"high"}')
  assert_status "Resolve provider" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  assert_has_field "Resolve provider (has provider)" "provider" "$body"

  # --- Create another provider with routing rules ---
  curl -s -X POST "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Routing Provider","providerType":"claude","apiKey":"sk-claude","model":"claude-3","is_project_director":true,"routing_rules":{"rules":[{"match":{"labels":["frontend"]},"model":"claude-3"}]}}' >/dev/null

  body=$(curl -s -X POST "${BASE}/api/v1/providers/resolve" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"labels":["frontend"],"priority":"high"}')
  assert_status "Resolve with routing rules" "200" "$(echo "$body" | jq -r '.success' 2>/dev/null)"
  local resolved_model
  resolved_model=$(echo "$body" | jq -r '.data.model')
  if [ "$resolved_model" = "claude-3" ]; then
    pass "Resolve routing rules (model=claude-3)"
  else
    fail "Resolve routing rules" "expected model=claude-3, got model=$resolved_model"
  fi

  # --- Delete Provider ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/providers/$provider_id" \
    -H "Authorization: Bearer $token")
  assert_status "Delete provider" "200" "$http_code"

  # --- Verify deleted provider returns 404 ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/providers/$provider_id" \
    -H "Authorization: Bearer $token")
  assert_status "Deleted provider returns 404" "404" "$http_code"

  # --- Deprecation: old per-project routes ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects/1/providers" \
    -H "Authorization: Bearer $token")
  assert_status "Old per-project GET returns 410" "410" "$http_code"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/projects/1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Old","providerType":"openai"}')
  assert_status "Old per-project POST returns 410" "410" "$http_code"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects/1/providers/" \
    -H "Authorization: Bearer $token")
  assert_status "Old per-project with trailing slash returns 410" "410" "$http_code"

  # --- Auth: no token ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/providers")
  assert_status "List providers without auth" "401" "$http_code"

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -d '{"name":"No Auth","providerType":"openai","apiKey":"sk-test"}')
  assert_status "Create provider without auth" "401" "$http_code"

  # --- Unique constraint: duplicate name+type ---
  curl -s -X POST "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Unique Test","providerType":"openai","apiKey":"sk-first"}' >/dev/null

  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Unique Test","providerType":"openai","apiKey":"sk-second"}')
  # Should fail due to unique constraint (400, 409, or 500 depending on DB error handling)
  if [ "$http_code" = "400" ] || [ "$http_code" = "409" ] || [ "$http_code" = "500" ]; then
    pass "Unique constraint: duplicate name+type rejected (HTTP $http_code)"
  else
    fail "Unique constraint" "expected 400/409/500, got HTTP $http_code"
  fi

  # --- Same name, different type should succeed ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Unique Test","providerType":"claude","apiKey":"sk-claude"}')
  assert_status "Same name, different type allowed" "201" "$http_code"
}
