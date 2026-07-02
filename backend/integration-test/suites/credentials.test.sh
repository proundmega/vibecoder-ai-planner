#!/usr/bin/env bash
# Secure API Keys (credentials) tests
source "$ROOT/integration-test/helpers.sh"

test_credentials() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Secure API Keys (rs-15)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local token
  token=$(login "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Credentials Test Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/credentials/$proj_id/credentials")
  assert_status "Credentials without auth returns 401" "401" "$code"

  local cred_body
  cred_body=$(curl -sf -X POST "${BASE}/api/v1/credentials/$proj_id/credentials" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Test API Key","type":"api_key","key":"sk-test-secret-key-12345"}')
  assert_has_field "Add credential returns id" "id" "$cred_body"
  assert_field "Credential name preserved" "name" "Test API Key" "$(echo "$cred_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"
  assert_field "Credential type preserved" "credentialType" "api_key" "$(echo "$cred_body" | grep -o '"credentialType":"[^"]*"' | cut -d'"' -f4)"

  local cred_id
  cred_id=$(echo "$cred_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)
  local current_cred_id="$cred_id"

  if echo "$cred_body" | grep -q '"keyMasked"'; then
    pass "Credential response includes keyMasked field"
  else
    fail "Credentials" "missing keyMasked field"
  fi

  local list_body
  list_body=$(curl -sf "${BASE}/api/v1/credentials/$proj_id/credentials" \
    -H "Authorization: Bearer $token")
  assert_has_field "List credentials returns array" "data" "$list_body"

  curl -sf -X POST "${BASE}/api/v1/credentials/$proj_id/credentials" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"GitHub PAT","type":"api_key","key":"ghp_test_pat_abc123xyz"}' >/dev/null 2>&1

  local update_body
  update_body=$(curl -sf -X PATCH "${BASE}/api/v1/credentials/$proj_id/credentials/$cred_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"name":"Updated API Key"}')
  assert_field "Update credential name" "name" "Updated API Key" "$(echo "$update_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  local rotate_body
  rotate_body=$(curl -sf -X POST "${BASE}/api/v1/credentials/$proj_id/credentials/$current_cred_id/rotate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $token" \
    -d '{"key":"sk-rotated-key-67890"}')
  assert_has_field "Rotate credential returns keyMasked" "keyMasked" "$rotate_body"
  current_cred_id=$(echo "$rotate_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local decrypt_body
  decrypt_body=$(curl -sf "${BASE}/api/v1/credentials/$proj_id/credentials/decrypt?type=api_key" \
    -H "Authorization: Bearer $token")
  if echo "$decrypt_body" | grep -q '"key"'; then
    pass "Decrypt returns decrypted key"
  else
    fail "Credentials decrypt" "missing key field"
  fi

  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/credentials/$proj_id/credentials/$current_cred_id" \
    -H "Authorization: Bearer $token")
  assert_status "Delete credential" "200" "$delete_code"
}
