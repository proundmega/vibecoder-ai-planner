#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== IP Whitelist Integration Test ==="

# 1. List whitelisted IPs
echo "1. Listing whitelisted IPs..."
LIST_RESPONSE=$(curl -s -X GET "$BASE_URL/api/v1/admin/ip-whitelist" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

echo "   List response: $LIST_RESPONSE"

# 2. Add IP to whitelist
echo "2. Adding IP to whitelist..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/admin/ip-whitelist" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip_address": "203.0.113.50", "description": "Test CI/CD"}')

IP_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$IP_ID" ]; then
  echo "   FAIL: Could not create whitelist entry. Response: $CREATE_RESPONSE"
  exit 1
fi

echo "   Created IP ID: $IP_ID"

# 3. Verify IP is in whitelist
echo "3. Verifying IP in whitelist..."
VERIFY_RESPONSE=$(curl -s -X GET "$BASE_URL/api/v1/admin/ip-whitelist" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$VERIFY_RESPONSE" | grep -q "203.0.113.50"; then
  echo "   PASS: IP found in whitelist"
else
  echo "   FAIL: IP not found in whitelist. Response: $VERIFY_RESPONSE"
  exit 1
fi

# 4. Reject invalid IP
echo "4. Testing invalid IP rejection..."
INVALID_RESPONSE=$(curl -s -X POST "$BASE_URL/api/v1/admin/ip-whitelist" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"ip_address": "not-an-ip", "description": "test"}')

if echo "$INVALID_RESPONSE" | grep -q '"error"'; then
  echo "   PASS: Invalid IP rejected"
else
  echo "   FAIL: Invalid IP accepted. Response: $INVALID_RESPONSE"
  exit 1
fi

# 5. Delete IP from whitelist
echo "5. Deleting IP from whitelist..."
DELETE_RESPONSE=$(curl -s -X DELETE "$BASE_URL/api/v1/admin/ip-whitelist/$IP_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

if echo "$DELETE_RESPONSE" | grep -q '"success":true'; then
  echo "   PASS: IP deleted successfully"
else
  echo "   FAIL: IP deletion failed. Response: $DELETE_RESPONSE"
  exit 1
fi

echo ""
echo "PASS: IP whitelist integration test complete"
