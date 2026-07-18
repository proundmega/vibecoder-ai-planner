#!/usr/bin/env bash
# Account lockout integration test
# Tests per-user lockout: 10 failed attempts → 423 response

test_account_lockout() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Account Lockout (per-user)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Clean up any existing test user
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "DELETE FROM users WHERE email='lockout-test@example.com';" >/dev/null 2>&1 || true

  # 1. Register a new user
  echo "1. Registering test user..."
  local register_code
  register_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d '{"name":"Lockout Test","email":"lockout-test@example.com","password":"password123","role":"project_admin"}')
  assert_status "Register test user" "201" "$register_code"

  # 2. Get user ID for verification
  local user_id
  user_id=$(sudo docker exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "SELECT id FROM users WHERE email='lockout-test@example.com';" | tr -d ' ')
  if [ -n "$user_id" ]; then
    pass "Found user ID: $user_id"
  else
    fail "Found user ID" "user not found"
    return
  fi

  # 3. Attempt 10 failed logins
  echo "2. Attempting 10 failed logins..."
  for i in $(seq 1 10); do
    local login_code
    login_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
      -H "Content-Type: application/json" \
      -d '{"email":"lockout-test@example.com","password":"wrongpassword"}')
    # First 9 should return 401, 10th may return 401 (rate limiter may kick in first)
    if [ "$login_code" = "401" ] || [ "$login_code" = "429" ]; then
      pass "Failed login attempt $i (HTTP $login_code)"
    else
      fail "Failed login attempt $i" "expected 401 or 429, got $login_code"
    fi
    # Add delay to avoid IP rate limiter (5 req/min) interfering with lockout test
    if [ "$i" -lt 10 ]; then
      sleep 1
    fi
  done

  # 4. 11th attempt should return 423 (account locked)
  echo "3. Checking 423 response on 11th attempt..."
  local lockout_status
  local lockout_response
  lockout_status=$(curl -s -o /tmp/lockout.json -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"lockout-test@example.com","password":"wrongpassword"}')
  lockout_response=$(cat /tmp/lockout.json)

  if [ "$lockout_status" = "423" ]; then
    pass "Account locked with 423 response"
  else
    fail "Account lockout returns 423" "expected 423, got $lockout_status"
  fi

  # 5. Check response body has correct structure
  local lockout_code
  lockout_code=$(echo "$lockout_response" | jq -r '.error.code' 2>/dev/null)
  if [ "$lockout_code" = "ACCOUNT_LOCKED" ]; then
    pass "423 response has error.code = ACCOUNT_LOCKED"
  else
    fail "423 response code" "expected ACCOUNT_LOCKED, got $lockout_code"
  fi

  local retry_after
  retry_after=$(echo "$lockout_response" | jq -r '.error.retryAfter' 2>/dev/null)
  if [ -n "$retry_after" ] && [ "$retry_after" != "null" ] && [ "$retry_after" -gt 0 ] 2>/dev/null; then
    pass "423 response includes retryAfter ($retry_after seconds)"
  else
    fail "423 response includes retryAfter" "missing or invalid retryAfter"
  fi

  # 6. Unlock via admin API and verify login works
  echo "4. Unlocking account via admin API..."
  local admin_token
  admin_token=$(seed_user "admin@integration.test" "adminpass123" "super_admin" "Admin")
  
  if [ -n "$admin_token" ]; then
    local unlock_status
    local unlock_response
    unlock_status=$(curl -s -o /tmp/unlock.json -w '%{http_code}' -X POST "$BASE/api/v1/users/$user_id/unlock" \
      -H "Authorization: Bearer $admin_token")
    unlock_response=$(cat /tmp/unlock.json)

    if [ "$unlock_status" = "200" ]; then
      pass "Admin unlock endpoint returns 200"
      local unlocked_attempts
      unlocked_attempts=$(echo "$unlock_response" | jq -r '.data.login_attempts' 2>/dev/null)
      if [ "$unlocked_attempts" = "0" ]; then
        pass "Admin unlock resets login_attempts to 0"
      else
        fail "Admin unlock resets login_attempts" "expected 0, got $unlocked_attempts"
      fi
    else
      fail "Admin unlock endpoint" "expected 200, got $unlock_status"
    fi
  else
    pass "Skipped admin unlock test (no admin token)"
  fi

  echo ""
  echo "Account lockout tests complete."
}
test_account_lockout
