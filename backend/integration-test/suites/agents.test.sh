#!/usr/bin/env bash
# AI Agent tests

test_agents() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  AI Agents"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(seed_user "alice@integration.test" "password123")

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/agents/create" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Test Agent"}')
  assert_status "Create agent" "201" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/agents" \
    -H "Authorization: Bearer $token")
  assert_status "List agents" "200" "$code"

  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/agents")
  assert_status "List agents without auth" "401" "$code"
}
test_agents
