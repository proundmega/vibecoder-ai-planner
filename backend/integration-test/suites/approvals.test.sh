#!/usr/bin/env bash
# Approvals API tests
source "$ROOT/integration-test/helpers.sh"

test_approvals_api() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Approvals API"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local admin_token
  admin_token=$(seed_user "alice@integration.test" "password123")

  local proj_id
  proj_id=$(curl -sf -X POST "${BASE}/api/v1/projects" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Approval Project","description":""}' \
    | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local ticket_body
  ticket_body=$(curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"title":"Approval Ticket","description":"Test"}')
  local ticket_id
  ticket_id=$(echo "$ticket_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"status":"in_progress"}' >/dev/null 2>&1

  curl -sf -X POST "${BASE}/api/v1/projects/$proj_id/tickets/$ticket_id/status" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"status":"review"}' >/dev/null 2>&1

  local approval_body
  approval_body=$(curl -sf -X POST "${BASE}/api/v1/approvals" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d "{\"ticketId\":\"$ticket_id\"}")
  assert_has_field "Create approval request" "id" "$approval_body"
  assert_field "Approval status is pending" "status" "pending" "$(echo "$approval_body" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)"

  local approval_id
  approval_id=$(echo "$approval_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local pending_body
  pending_body=$(curl -sf "${BASE}/api/v1/approvals/pending" \
    -H "Authorization: Bearer $admin_token")
  assert_has_field "Get pending approvals" "data" "$pending_body"

  local approve_body
  approve_body=$(curl -sf -X POST "${BASE}/api/v1/approvals/$approval_id/approve" \
    -H "Authorization: Bearer $admin_token")
  local approve_status
  approve_status=$(echo "$approve_body" | grep -o '"status":"approved"' | head -1 | cut -d'"' -f4)
  assert_field "Approve transitions to approved" "status" "approved" "$approve_status"

  local approve_code
  approve_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/approvals/$approval_id/approve" \
    -H "Authorization: Bearer $admin_token")
  assert_status "Cannot approve already approved" "400" "$approve_code"

  local user_token
  user_token=$(seed_user "perm_user@integration.test" "password123" "user")
  local user_approve_code
  user_approve_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/approvals/$approval_id/approve" \
    -H "Authorization: Bearer $user_token")
  assert_status "User role cannot approve" "403" "$user_approve_code"
}
