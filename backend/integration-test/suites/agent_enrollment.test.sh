#!/usr/bin/env bash
# fg-53: mint join token -> enroll -> use access token -> refresh -> revoke.
# Expects the bash integration harness (helpers.sh) to be sourced.

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Agent Enrollment (fg-53)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

local user_token proj_body project_id mint_body join_token
local enroll_body agent_id access_token refresh_token code

user_token=$(register "Enroll Admin" "enroll@test.com" "password123" "project_admin")
if [ -n "$user_token" ]; then
  pass "Register enrollment admin (got token)"
else
  fail "Register enrollment admin" "no token returned"
fi

proj_body=$(curl_sf "$BASE/api/v1/projects" \
  -H "Authorization: Bearer $user_token" \
  -H "Content-Type: application/json" \
  -d '{"name":"Enrollment Project","description":"fg-53 enrollment flow"}')
project_id=$(echo "$proj_body" | extract_id)
if [ -n "$project_id" ] && [ "$project_id" != "null" ]; then
  pass "Enrollment project created (id=$project_id)"
else
  fail "Enrollment project created" "no id returned"
fi

mint_body=$(curl_sf "$BASE/api/v1/agent-enrollment/tokens" \
  -H "Authorization: Bearer $user_token" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":$project_id,\"name\":\"join-1\",\"ttl_seconds\":900,\"max_uses\":1}")
join_token=$(echo "$mint_body" | extract_field "token")
if [[ "$join_token" == enr_* ]]; then
  pass "Minted one-time join token"
else
  fail "Minted one-time join token" "token missing or wrong prefix"
fi

enroll_body=$(curl_sf "$BASE/api/v1/agent-enrollment/enroll" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$join_token\",\"name\":\"auto-node\",\"node_metadata\":{\"hostname\":\"ci\"}}")
agent_id=$(echo "$enroll_body" | extract_field "agent_id")
access_token=$(echo "$enroll_body" | extract_field "access_token")
refresh_token=$(echo "$enroll_body" | extract_field "refresh_token")

if [ -n "$agent_id" ] && [ "$agent_id" != "null" ]; then
  pass "Enrollment created an agent (id=$agent_id)"
else
  fail "Enrollment created an agent" "no agent_id returned"
fi
if [[ "$access_token" == at_* ]] && [[ "$refresh_token" == ar_* ]]; then
  pass "Enrollment returned access + refresh credentials"
else
  fail "Enrollment returned access + refresh credentials" "wrong token prefixes"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/$agent_id/history" \
  -H "X-API-Key: $access_token")
if [ "$code" != "401" ]; then
  pass "Access token authenticates agent routes (HTTP $code)"
else
  fail "Access token authenticates agent routes" "returned 401"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agent-enrollment/enroll" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$join_token\",\"name\":\"second-node\"}")
assert_status "Single-use join token cannot enroll twice" "401" "$code"

local refresh_body new_access
refresh_body=$(curl_sf "$BASE/api/v1/agent-enrollment/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}")
new_access=$(echo "$refresh_body" | extract_field "access_token")
if [[ "$new_access" == at_* ]] && [ "$new_access" != "$access_token" ]; then
  pass "Refresh rotated the access token"
else
  fail "Refresh rotated the access token" "no new access token"
fi

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agent-enrollment/refresh" \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$refresh_token\"}")
assert_status "Rotated refresh token cannot be reused" "401" "$code"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/$agent_id/history" \
  -H "X-API-Key: $new_access")
assert_status "Rotated access token still authenticates" "200" "$code"

# Revoking the agent must invalidate the enrollment credentials too.
curl_sf "$BASE/api/v1/agents/revoke/$agent_id" \
  -H "Authorization: Bearer $user_token" >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agents/$agent_id/history" \
  -H "X-API-Key: $new_access")
assert_status "Revoked agent rejects its access token" "401" "$code"

# Concurrent use of a single-use token must produce exactly one agent.
local conc_body conc_token tmp_a tmp_b
conc_body=$(curl_sf "$BASE/api/v1/agent-enrollment/tokens" \
  -H "Authorization: Bearer $user_token" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":$project_id,\"name\":\"join-concurrent\",\"max_uses\":1}")
conc_token=$(echo "$conc_body" | extract_field "token")
tmp_a=$(mktemp)
tmp_b=$(mktemp)
curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agent-enrollment/enroll" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$conc_token\",\"name\":\"race-a\"}" >"$tmp_a" &
local pid_a=$!
curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agent-enrollment/enroll" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$conc_token\",\"name\":\"race-b\"}" >"$tmp_b" &
local pid_b=$!
wait "$pid_a" "$pid_b"
local code_a code_b
code_a=$(cat "$tmp_a")
code_b=$(cat "$tmp_b")
rm -f "$tmp_a" "$tmp_b"
if { [ "$code_a" = "201" ] && [ "$code_b" = "401" ]; } || { [ "$code_a" = "401" ] && [ "$code_b" = "201" ]; }; then
  pass "Concurrent enrollment consumes a single-use token once"
else
  fail "Concurrent enrollment consumes a single-use token once" "got $code_a / $code_b"
fi

# A revoked join token cannot be exchanged.
local mint2_body join2_id join2_token
mint2_body=$(curl_sf "$BASE/api/v1/agent-enrollment/tokens" \
  -H "Authorization: Bearer $user_token" \
  -H "Content-Type: application/json" \
  -d "{\"project_id\":$project_id,\"name\":\"join-2\"}")
join2_token=$(echo "$mint2_body" | extract_field "token")
join2_id=$(echo "$mint2_body" | extract_id)
curl_sf "$BASE/api/v1/agent-enrollment/tokens/$join2_id" \
  -H "Authorization: Bearer $user_token" -X DELETE >/dev/null
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/v1/agent-enrollment/enroll" \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$join2_token\",\"name\":\"revoked-node\"}")
assert_status "Revoked join token cannot enroll" "401" "$code"
