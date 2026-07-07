#!/usr/bin/env bash
# JWT token expiry tests
source "$ROOT/integration-test/helpers.sh"

test_jwt_token_expiry() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  JWT Token Expiry"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local payload
  payload=$(node -e "const parts=process.argv[1].split('.'); const buf=Buffer.from(parts[1].replace(/-/g,'+').replace(/_/g,'/'),'base64'); console.log(buf.toString('utf8'));" "$token" 2>/dev/null)

  if echo "$payload" | grep -q '"exp"'; then
    pass "JWT token contains exp field"
  else
    fail "JWT token" "exp field not found in token payload"
  fi

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects" \
    -H "Authorization: Bearer $token")
  assert_status "Valid JWT token works for API calls" "200" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/projects" \
    -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxIiwiZW1haWwiOiJ0ZXN0QHRlc3QuY29tIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.invalid")
  assert_status "Invalid JWT token is rejected" "401" "$code"
}
