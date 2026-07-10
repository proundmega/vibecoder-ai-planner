#!/usr/bin/env bash
# Shared helpers for all integration test suites.
# Source this file from run.sh and individual suite files.

PASS=0
FAIL=0
TESTS=()

pass() { PASS=$((PASS + 1)); TESTS+=("✓ $1"); }
fail() { FAIL=$((FAIL + 1)); TESTS+=("✗ $1 — $2"); }

# curl with -sf but doesn't abort on HTTP errors (returns empty on failure)
curl_sf() {
  curl -sf "$@" 2>/dev/null || true
}

wait_for_api() {
  echo "Waiting for API on :3001..."
  for i in $(seq 1 $RETRIES); do
    if curl -sf "$BASE/api/health" >/dev/null 2>&1; then
      echo "API is ready."
      return 0
    fi
    sleep $RETRY_INTERVAL
  done
  echo "API did not become ready in time."
  exit 1
}

clean_db() {
  echo "Cleaning database..."
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode \
    -c "DELETE FROM agent_memory CASCADE; DELETE FROM usage_logs CASCADE; DELETE FROM project_billing CASCADE; DELETE FROM project_credentials CASCADE; DELETE FROM ticket_messages CASCADE; DELETE FROM tickets CASCADE; DELETE FROM agent_actions CASCADE; DELETE FROM ai_actions CASCADE; DELETE FROM projects CASCADE; DELETE FROM users CASCADE;" 2>/dev/null || true
  # Clear Redis rate limit and lockout state
  sudo docker exec vibecode-redis redis-cli KEYS "lockout:*" 2>/dev/null | while read -r key; do
    sudo docker exec vibecode-redis redis-cli DEL "$key" 2>/dev/null || true
  done
  sudo docker exec vibecode-redis redis-cli KEYS "ratelimit:*" 2>/dev/null | while read -r key; do
    sudo docker exec vibecode-redis redis-cli DEL "$key" 2>/dev/null || true
  done
}

register() {
  local name="$1" email="$2" password="$3"
  local role="${4:-project_admin}"
  local response http_code body
  # If user already exists, delete them first to make registration idempotent
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "DELETE FROM users WHERE email='$email';" >/dev/null 2>&1 || true
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" = "201" ]; then
    echo "$body" | jq -r '.token'
  else
    echo "" >&2
    echo "REGISTER FAILED: $http_code $body" >&2
  fi
}

seed_user() {
  # Register a user if they don't exist, then login and return token.
  # This ensures tests work after clean_db deletes all users.
  local email="$1" password="$2" role="${3:-project_admin}" name="${4:-User}"
  local response http_code body
  # Try login first (fast path if user exists with correct password)
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" = "200" ]; then
    echo "$body" | jq -r '.token'
    return
  fi
  # User doesn't exist or has wrong password — delete any existing user and register fresh
  sudo docker exec vibecode-postgres psql -U postgres -d vibecode -t -c \
    "DELETE FROM users WHERE email='$email';" >/dev/null 2>&1 || true
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" = "201" ]; then
    echo "$body" | jq -r '.token'
  else
    echo ""
  fi
}

login() {
  local email="$1" password="$2"
  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" = "200" ]; then
    echo "$body" | jq -r '.token'
  else
    echo ""
  fi
}

assert_status() {
  local label="$1" expected="$2" actual="$3"
  if [ "$actual" = "$expected" ]; then
    pass "$label (HTTP $actual)"
  else
    fail "$label" "expected HTTP $expected, got HTTP $actual"
  fi
}

assert_field() {
  local label="$1" field="$2" expected="$3" data="$4"
  # If data is a JSON object or array, extract field via jq
  if [[ "$data" == \{* ]] || [[ "$data" == \[* ]]; then
    local actual
    actual=$(echo "$data" | jq -r ".$field" 2>/dev/null)
    if [ -z "$actual" ] || [ "$actual" = "null" ]; then
      # Field not at root, try inside .data (handle both object and array cases)
      actual=$(echo "$data" | jq -r '(.data // .) | if type == "array" then .[0] else . end | .'"$field" 2>/dev/null)
    fi
    if [ -z "$actual" ] || [ "$actual" = "null" ]; then
      actual="__NULL__"
    fi
    if [ "$actual" = "__NULL__" ]; then
      if [ "$expected" = "__NULL__" ]; then
        pass "$label ($field=null)"
      else
        fail "$label" "Expected $field=$expected, got null"
      fi
    elif [ "$actual" != "$expected" ]; then
      fail "$label" "Expected $field=$expected, got $field=$actual"
    else
      pass "$label ($field=$expected)"
    fi
  else
    # Scalar value — legacy comparison (pre-extracted value passed as $4)
    if [ "$data" = "$expected" ]; then
      pass "$label ($field=$expected)"
    else
      fail "$label" "expected $field=$expected, got $field=$data"
    fi
  fi
}

assert_has_field() {
  local label="$1" field="$2" json="$3"
  if echo "$json" | jq -e "has(\"$field\")" >/dev/null 2>&1; then
    pass "$label (has $field)"
  elif echo "$json" | jq -e '(.data // .) | if type == "array" then .[0] else . end | has("'"$field"'")' >/dev/null 2>&1; then
    pass "$label (has $field in data)"
  else
    fail "$label" "missing field $field"
  fi
}

assert_no_field() {
  local label="$1" field="$2" json="$3"
  if ! echo "$json" | jq -e "has(\"$field\")" >/dev/null 2>&1 && \
     ! echo "$json" | jq -e '(.data // .) | if type == "array" then .[0] else . end | has("'"$field"'")' >/dev/null 2>&1; then
    pass "$label (no $field)"
  else
    fail "$label" "unexpected field $field"
  fi
}

# Legacy grep-based versions for backwards compatibility
assert_field_legacy() {
  local label="$1" field="$2" expected="$3" actual="$4"
  if [ "$actual" = "$expected" ]; then
    pass "$label ($field=$expected)"
  else
    fail "$label" "expected $field=$expected, got $field=$actual"
  fi
}

assert_has_field_legacy() {
  local label="$1" field="$2" json="$3"
  if echo "$json" | grep -q "\"$field\""; then
    pass "$label (has $field)"
  else
    fail "$label" "missing field $field"
  fi
}

assert_no_field_legacy() {
  local label="$1" field="$2" json="$3"
  if ! echo "$json" | grep -q "\"$field\""; then
    pass "$label (no $field)"
  else
    fail "$label" "unexpected field $field"
  fi
}

# Extract a field from API response, handling .data wrapper
# Usage: extract_field "$json" "id"  OR  echo "$json" | extract_field "id"
extract_field() {
  local json field
  if [ -n "${2:-}" ]; then
    # Called as extract_field "$json" "field"
    json="$1"
    field="$2"
  elif [ -n "${1:-}" ]; then
    # Called as echo "$json" | extract_field "field"
    json=$(cat)
    field="$1"
  else
    # Called as echo "$json" | extract_field (no field specified, default to "id")
    json=$(cat)
    field="id"
  fi
  echo "$json" | jq -r "(.data // .) | if type == \"array\" then .[0].${field} else .${field} end" 2>/dev/null
}

# Extract ID from API response
# Usage: extract_id "$json"  OR  echo "$json" | extract_id
extract_id() {
  if [ -n "${1:-}" ]; then
    extract_field "$1" "id"
  else
    local json
    json=$(cat)
    echo "$json" | jq -r "(.data // .) | if type == \"array\" then .[0].id else .id end" 2>/dev/null
  fi
}
