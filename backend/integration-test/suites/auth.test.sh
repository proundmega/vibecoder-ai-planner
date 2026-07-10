#!/usr/bin/env bash
# Authentication tests
source "$ROOT/integration-test/helpers.sh"

test_auth() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Authentication"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Delete any existing user to make registration idempotent
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "DELETE FROM approval_requests WHERE requested_by=(SELECT id FROM users WHERE email='alice@integration.test');" >/dev/null 2>&1 || true
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "DELETE FROM users WHERE email='alice@integration.test';" >/dev/null 2>&1 || true
  
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
  if [ -n "$token" ]; then
    pass "Login returns token (got token)"
  else
    fail "Login returns token" "no token returned"
  fi

  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"alice@integration.test","password":"wrongpassword"}')
  assert_status "Reject wrong password" "401" "$code"

  local me_body
  me_body=$(curl_sf "$BASE/api/auth/me" -H "Authorization: Bearer $token")
  assert_has_field "GET /auth/me returns user" "user" "$me_body"
  local user_id
  user_id=$(echo "$me_body" | jq -r '(.data // .) | if type == "object" then .user.id else .id end // empty' 2>/dev/null)
  if [ -n "$user_id" ]; then
    pass "GET /auth/me returns user with id (got $user_id)"
  else
    fail "GET /auth/me returns user with id" "missing id in user object"
  fi

  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me")
  assert_status "GET /auth/me without token returns 401" "401" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/auth/me" -H "Authorization: Bearer invalid-token")
  assert_status "GET /auth/me with invalid token returns 401" "401" "$code"
}
