#!/usr/bin/env bash
# Authentication tests
source "$ROOT/integration-test/helpers.sh"

test_auth() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Authentication"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Alice","email":"alice@integration.test","password":"password123","role":"project_admin"}')
  assert_status "Register new user" "201" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Alice","email":"alice@integration.test","password":"password123","role":"project_admin"}')
  assert_status "Reject duplicate registration" "400" "$code"

  local token
  token=$(login "alice@integration.test" "password123")
  assert_has_field "Login returns token" "token" "{\"token\":\"$token\"}"

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@integration.test","password":"wrongpassword"}')
  assert_status "Reject wrong password" "401" "$code"

  local me_body
  me_body=$(curl -sf "$BASE/api/auth/me" -H "Authorization: Bearer $token")
  assert_has_field "GET /auth/me returns user" "user" "$me_body"
  assert_has_field "GET /auth/me returns user with id" "id" "$me_body"

  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")
  assert_status "GET /auth/me without token returns 401" "401" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" -H "Authorization: Bearer invalid-token")
  assert_status "GET /auth/me with invalid token returns 401" "401" "$code"
}
