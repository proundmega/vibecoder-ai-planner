#!/usr/bin/env bash
# Role-based user management tests
source "$ROOT/integration-test/helpers.sh"

test_role_based_user_management() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Role-Based User Management"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  local admin_token
  admin_token=$(login "alice@integration.test" "password123")

  local member_body
  member_body=$(curl -sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Member User","email":"member@integration.test","password":"password123","role":"member"}')
  assert_has_field "Admin can create member user" "id" "$member_body"
  assert_field "Created user has member role" "role" "member" "$(echo "$member_body" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)"

  local member_id
  member_id=$(echo "$member_body" | grep -o '"id":"[^"]*"' | cut -d'"' -f4)

  local user_body
  user_body=$(curl -sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"AI User","email":"aiuser@integration.test","password":"password123","role":"user"}')
  assert_has_field "Admin can create user role" "id" "$user_body"
  assert_field "Created user has user role" "role" "user" "$(echo "$user_body" | grep -o '"role":"[^"]*"' | cut -d'"' -f4)"

  local update_body
  update_body=$(curl -sf -X PUT "${BASE}/api/v1/users/$member_id" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $admin_token" \
    -d '{"name":"Updated Member"}')
  assert_field "Admin can update user name" "name" "Updated Member" "$(echo "$update_body" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)"

  local deact_body
  deact_body=$(curl -sf -X PATCH "${BASE}/api/v1/users/$member_id/toggle-active" \
    -H "Authorization: Bearer $admin_token")
  assert_field "Admin can deactivate user" "isActive" "false" "$(echo "$deact_body" | grep -o '"isActive":[a-z]*' | cut -d':' -f2)"

  local deact_login_code
  deact_login_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"member@integration.test","password":"password123"}')
  assert_status "Deactivated user cannot login" "401" "$deact_login_code"

  local react_body
  react_body=$(curl -sf -X PATCH "${BASE}/api/v1/users/$member_id/toggle-active" \
    -H "Authorization: Bearer $admin_token")
  assert_field "Admin can reactivate user" "isActive" "true" "$(echo "$react_body" | grep -o '"isActive":[a-z]*' | cut -d':' -f2)"

  local list_body
  list_body=$(curl -sf "${BASE}/api/v1/users" \
    -H "Authorization: Bearer $admin_token")
  assert_has_field "Admin can list users" "users" "$list_body"

  local user_token
  user_token=$(login "aiuser@integration.test" "password123")
  local create_code
  create_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $user_token" \
    -d '{"name":"Another","email":"another@integration.test","password":"password123","role":"user"}')
  assert_status "Regular user cannot create users" "403" "$create_code"

  local member_token
  member_token=$(login "member@integration.test" "password123")
  local member_create_body
  member_create_body=$(curl -sf -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $member_token" \
    -d '{"name":"Agent","email":"agent@integration.test","password":"password123","role":"user"}')
  assert_has_field "Member can create user role" "id" "$member_create_body"

  local member_create_code
  member_create_code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "${BASE}/api/v1/users" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $member_token" \
    -d '{"name":"Another Member","email":"anothermember@integration.test","password":"password123","role":"member"}')
  assert_status "Member cannot create member role" "400" "$member_create_code"

  local delete_code
  delete_code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${BASE}/api/v1/users/$member_id" \
    -H "Authorization: Bearer $admin_token")
  assert_status "Admin can delete user" "200" "$delete_code"

  local super_code
  super_code=$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/api/v1/users/super-admin" \
    -H "Authorization: Bearer $admin_token")
  assert_status "Non-super-admin cannot access super-admin endpoint" "403" "$super_code"
}
