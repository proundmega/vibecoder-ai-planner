#!/usr/bin/env bash
# Usage tracking & cost logging tests
source "$ROOT/integration-test/helpers.sh"

test_usage_tracking() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Usage Tracking & Cost Logging (rs-17)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl_sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Usage Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local pricing_body
  pricing_body=$(curl_sf "${BASE}/api/v1/usage/pricing/models" \
    -H "Authorization: Bearer $token")
  assert_has_field "Model pricing returns models" "data" "$pricing_body"

  if echo "$pricing_body" | grep -qi '"claude-'; then
    pass "Pricing includes Claude models"
  else
    fail "Usage pricing" "Claude models not found"
  fi

  if echo "$pricing_body" | grep -q '"gpt-4"'; then
    pass "Pricing includes OpenAI models"
  else
    fail "Usage pricing" "OpenAI models not found"
  fi

  local usage_body
  usage_body=$(curl_sf "${BASE}/api/v1/usage/projects/$proj_id/usage" \
    -H "Authorization: Bearer $token")
  assert_has_field "Project usage returns data" "data" "$usage_body"

  local user_usage_body
  user_usage_body=$(curl_sf "${BASE}/api/v1/usage/users/me/usage" \
    -H "Authorization: Bearer $token")
  assert_has_field "User usage returns data" "data" "$user_usage_body"
}
