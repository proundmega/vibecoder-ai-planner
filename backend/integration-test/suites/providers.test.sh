#!/usr/bin/env bash
# Provider route tests

# Helper: single curl call that captures both body and HTTP code
# Usage: http_post "url" "headers..." "data" -> sets HTTP_CODE and RESPONSE_BODY
http_post() {
  local url="$1"; shift
  local response
  response=$(curl -s -w '\n%{http_code}' -X POST "$url" "$@")
  HTTP_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

http_get() {
  local url="$1"; shift
  local response
  response=$(curl -s -w '\n%{http_code}' "$url" "$@")
  HTTP_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

http_patch() {
  local url="$1"; shift
  local response
  response=$(curl -s -w '\n%{http_code}' -X PATCH "$url" "$@")
  HTTP_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

http_delete() {
  local url="$1"; shift
  local response
  response=$(curl -s -w '\n%{http_code}' -X DELETE "$url" "$@")
  HTTP_CODE="${response##*$'\n'}"
  RESPONSE_BODY="${response%$'\n'*}"
}

test_providers() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Providers (Global)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "providers@integration.test" "password123" "project_admin" "Provider Test User")

  # --- Create Provider ---
  http_post "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Integration Provider","providerType":"openai","apiKey":"sk-integration-test-key","model":"gpt-4o","roles":["worker"]}'
  assert_status "Create provider" "201" "$HTTP_CODE"
  assert_field "Create provider (success)" "success" "true" "$RESPONSE_BODY"
  assert_has_field "Create provider (has id)" "id" "$RESPONSE_BODY"

  local provider_id
  provider_id=$(echo "$RESPONSE_BODY" | jq -r '(.data // .) | .id')

  # --- List Providers ---
  http_get "${BASE}/api/v1/providers" \
    -H "Authorization: Bearer $token"
  assert_status "List providers" "200" "$HTTP_CODE"
  assert_field "List providers (success)" "success" "true" "$RESPONSE_BODY"
  local count
  count=$(echo "$RESPONSE_BODY" | jq '.data | length')
  if [ "$count" -gt 0 ]; then
    pass "List providers (has $count providers)"
  else
    fail "List providers" "expected at least 1 provider"
  fi

  # --- Get Provider by ID ---
  http_get "${BASE}/api/v1/providers/$provider_id" \
    -H "Authorization: Bearer $token"
  assert_status "Get provider by ID" "200" "$HTTP_CODE"
  assert_field "Get provider (name)" "name" "Integration Provider" "$RESPONSE_BODY"

  # --- Get non-existent provider ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/providers/999999999" \
    -H "Authorization: Bearer $token")
  assert_status "Get non-existent provider" "404" "$http_code"

  # --- Update Provider ---
  http_patch "${BASE}/api/v1/providers/$provider_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Updated Provider","model":"gpt-4o"}'
  assert_status "Update provider" "200" "$HTTP_CODE"
  assert_field "Update provider (name)" "name" "Updated Provider" "$RESPONSE_BODY"

  # --- Update with empty body ---
  http_code=$(curl -s -o /dev/null -w '%{http_code}' -X PATCH "${BASE}/api/v1/providers/$provider_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{}')
  assert_status "Update with empty body" "400" "$http_code"

  # --- Set Director ---
  http_patch "${BASE}/api/v1/providers/$provider_id/directorship" \
    -H "Authorization: Bearer $token"
  assert_status "Set provider as director" "200" "$HTTP_CODE"
  assert_field "Set director (is_project_director)" "is_project_director" "true" "$RESPONSE_BODY"

  # --- Test Provider Connection ---
  http_post "${BASE}/api/v1/providers/$provider_id/test" \
    -H "Authorization: Bearer $token"
  assert_status "Test provider connection" "200" "$HTTP_CODE"
  assert_has_field "Test provider (has message)" "message" "$RESPONSE_BODY"

  # --- Get Provider Agents ---
  http_get "${BASE}/api/v1/providers/$provider_id/agents" \
    -H "Authorization: Bearer $token"
  assert_status "Get provider agents" "200" "$HTTP_CODE"

  # --- Resolve Provider ---
  http_post "${BASE}/api/v1/providers/resolve" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"labels":["test"],"priority":"high"}'
  assert_status "Resolve provider" "200" "$HTTP_CODE"
  assert_has_field "Resolve provider (has provider)" "provider" "$RESPONSE_BODY"

  # --- Create another provider with routing rules ---
  http_post "${BASE}/api/v1/providers" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Routing Provider","providerType":"claude","apiKey":"sk-claude","model":"claude-3","is_project_director":true,"routing_rules":{"rules":[{"match":{"labels":["frontend"]},"model":"claude-3"}]}}' >/dev/null

  http_post "${BASE}/api/v1/providers/resolve" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"labels":["frontend"],"priority":"high"}'
  assert_status "Resolve with routing rules" "200" "$HTTP_CODE"
  local resolved_model
  resolved_model=$(echo "$RESPONSE_BODY" | jq -r '.data.model')
  if [ "$resolved_model" = "claude-3" ]; then
    pass "Resolve routing rules (model=claude-3)"
  else
    fail "Resolve routing rules" "expected model=claude-3, got model=$resolved_model"
  fi

  # --- Delete Provider ---
  http_delete "${BASE}/api/v1/providers/$provider_id" \
    -H "Authorization: Bearer $token"
  assert_status "Delete provider" "200" "$HTTP_CODE"

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
  http_post "${BASE}/api/v1/providers" \
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
test_providers
