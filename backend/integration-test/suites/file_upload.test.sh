#!/usr/bin/env bash
# File upload / attachment tests
source "$ROOT/integration-test/helpers.sh"

test_file_upload() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  File Upload"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local user_token project_id ticket_id

  # Register and login
  user_token=$(register "Upload User" "upload@test.com" "password123" "project_admin")
  if [ -n "$user_token" ]; then
    pass "Register upload user (got token)"
  else
    fail "Register upload user" "no token returned"
  fi

  # Create project
  local proj_body
  proj_body=$(curl -sf "$BASE/api/v1/projects" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"name":"Upload Project","description":"For testing file uploads"}')
  project_id=$(echo "$proj_body" | extract_id)

  # Create ticket
  local ticket_body
  ticket_body=$(curl -sf "$BASE/api/v1/projects/$project_id/tickets" \
    -H "Authorization: Bearer $user_token" \
    -H "Content-Type: application/json" \
    -d '{"title":"Upload Ticket","description":"Test ticket for attachments","status":"backlog"}')
  ticket_id=$(echo "$ticket_body" | extract_id)

  # Create a temp file to upload
  local tmpfile
  tmpfile=$(mktemp /tmp/upload_test_XXXXXX.txt)
  echo "This is a test attachment file for integration testing." > "$tmpfile"

  # Upload file as attachment
  local upload_body upload_code
  upload_body=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/v1/tickets/$ticket_id/attachments" \
    -H "Authorization: Bearer $user_token" \
    -F "file=@$tmpfile;type=text/plain" 2>/dev/null)
  upload_code=$(echo "$upload_body" | tail -1)
  assert_status "File upload succeeds" "201" "$upload_code"

  # Verify response has expected fields
  local upload_json
  upload_json=$(echo "$upload_body" | sed '$d')
  assert_has_field "Upload response has id" "id" "$upload_json"
  assert_has_field "Upload response has filename" "filename" "$upload_json"
  assert_has_field "Upload response has content_type" "content_type" "$upload_json"
  assert_has_field "Upload response has size_bytes" "size_bytes" "$upload_json"

  # Verify stored_path is NOT in response (security: don't expose internal paths)
  assert_no_field "Upload response does NOT expose stored_path" "stored_path" "$upload_json"

  # Test: Upload to non-existent ticket returns 404
  local notfound_code
  notfound_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/tickets/nonexistent-id/attachments" \
    -H "Authorization: Bearer $user_token" \
    -F "file=@$tmpfile;type=text/plain" 2>/dev/null)
  assert_status "Upload to non-existent ticket returns 404" "404" "$notfound_code"

  # Test: Unauthenticated upload returns 401
  local auth_code
  auth_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/tickets/$ticket_id/attachments" \
    -F "file=@$tmpfile;type=text/plain" 2>/dev/null)
  assert_status "Unauthenticated upload returns 401" "401" "$auth_code"

  # Clean up temp file
  rm -f "$tmpfile"
}
