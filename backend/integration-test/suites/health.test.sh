#!/usr/bin/env bash
# Health & Version tests

test_health() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Health & Version"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local body
  body=$(curl_sf "$BASE/api/health")
  assert_field "Health returns ok" "status" "ok" "$(echo "$body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  body=$(curl_sf "$BASE/api/version")
  assert_field "Version returns 1.0.0" "version" "1.0.0" "$(echo "$body" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)"
}
test_health
