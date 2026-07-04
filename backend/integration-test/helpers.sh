#!/usr/bin/env bash
# Shared helpers for all integration test suites.
# Source this file from run.sh and individual suite files.

PASS=0
FAIL=0
TESTS=()

pass() { PASS=$((PASS + 1)); TESTS+=("✓ $1"); }
fail() { FAIL=$((FAIL + 1)); TESTS+=("✗ $1 — $2"); }

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
}

register() {
  local name="$1" email="$2" password="$3"
  local role="${4:-project_admin}"
  local response http_code body
  response=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
  http_code=$(echo "$response" | tail -1)
  body=$(echo "$response" | sed '$d')
  if [ "$http_code" = "201" ]; then
    echo "$body" | jq -r '.token // empty'
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
    echo "$body" | jq -r '.token // empty'
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
  local label="$1" field="$2" expected="$3" json="$4"
  if ! echo "$json" | jq -e "has(\"$field\")" >/dev/null 2>&1; then
    fail "$label" "Field '$field' not found in JSON"
    return
  fi
  local actual
  actual=$(echo "$json" | jq -r ".$field // \"__NULL__\"")
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
}

assert_has_field() {
  local label="$1" field="$2" json="$3"
  if echo "$json" | jq -e "has(\"$field\")" >/dev/null 2>&1; then
    pass "$label (has $field)"
  else
    fail "$label" "missing field $field"
  fi
}

assert_no_field() {
  local label="$1" field="$2" json="$3"
  if ! echo "$json" | jq -e "has(\"$field\")" >/dev/null 2>&1; then
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
