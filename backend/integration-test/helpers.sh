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
  local code body
  body=$(curl -sf -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"$name\",\"email\":\"$email\",\"password\":\"$password\",\"role\":\"$role\"}")
  if [ "$code" = "201" ]; then
    echo "$body" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
  else
    echo ""
  fi
}

login() {
  local email="$1" password="$2"
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$email\",\"password\":\"$password\"}")
  if [ "$code" = "200" ]; then
    curl -s -X POST "$BASE/api/auth/login" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"$email\",\"password\":\"$password\"}" \
      | grep -o '"token":"[^"]*"' | cut -d'"' -f4
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
  local label="$1" field="$2" expected="$3" actual="$4"
  if [ "$actual" = "$expected" ]; then
    pass "$label ($field=$expected)"
  else
    fail "$label" "expected $field=$expected, got $field=$actual"
  fi
}

assert_has_field() {
  local label="$1" field="$2" json="$3"
  if echo "$json" | grep -q "\"$field\""; then
    pass "$label (has $field)"
  else
    fail "$label" "missing field $field"
  fi
}

assert_no_field() {
  local label="$1" field="$2" json="$3"
  if ! echo "$json" | grep -q "\"$field\""; then
    pass "$label (no $field)"
  else
    fail "$label" "unexpected field $field"
  fi
}
