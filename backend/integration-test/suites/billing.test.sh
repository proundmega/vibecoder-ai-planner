#!/usr/bin/env bash
# Billing aggregation tests
source "$ROOT/integration-test/helpers.sh"

test_billing() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Billing Aggregation (rs-17)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Billing Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local billing_body
  billing_body=$(curl -sf "${BASE}/api/v1/billing/projects/$proj_id/billing" \
    -H "Authorization: Bearer $token")
  assert_has_field "Project billing returns data" "data" "$billing_body"

  local user_billing_body
  user_billing_body=$(curl -sf "${BASE}/api/v1/billing/users/me/billing" \
    -H "Authorization: Bearer $token")
  assert_has_field "User billing returns data" "data" "$user_billing_body"
}
