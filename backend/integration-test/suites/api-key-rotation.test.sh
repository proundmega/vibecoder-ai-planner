#!/bin/bash
set -e

BASE_URL="${BASE_URL:-http://localhost:3001}"

echo "=== API Key Rotation Integration Test ==="

# 1. Create an agent
echo "1. Creating agent..."
CREATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/create" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-key-rotation-agent"}')

AGENT_ID=$(echo "$CREATE_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
AGENT_KEY=$(echo "$CREATE_RESPONSE" | grep -o '"api_key":"[^"]*"' | cut -d'"' -f4)

if [ -z "$AGENT_ID" ] || [ -z "$AGENT_KEY" ]; then
  echo "FAIL: Could not create agent. Response: $CREATE_RESPONSE"
  exit 1
fi

echo "   Agent ID: $AGENT_ID"
echo "   Agent Key: ${AGENT_KEY:0:10}..."

# 2. Verify agent key works (via agentAuth middleware)
echo "2. Verifying agent key works..."
KEY_RESPONSE=$(curl -s -X GET "$BASE_URL/api/v1/projects" \
  -H "X-API-Key: $AGENT_KEY")

if echo "$KEY_RESPONSE" | grep -q '"success":true\|"projects"'; then
  echo "   PASS: Agent key is valid"
else
  echo "   FAIL: Agent key not working. Response: $KEY_RESPONSE"
  exit 1
fi

# 3. Rotate the key
echo "3. Rotating key..."
ROTATE_RESPONSE=$(curl -s -X POST "$BASE_URL/api/agents/$AGENT_ID/rotate-key" \
  -H "Authorization: Bearer $ADMIN_TOKEN")

NEW_KEY=$(echo "$ROTATE_RESPONSE" | grep -o '"newApiKey":"[^"]*"' | cut -d'"' -f4)

if [ -z "$NEW_KEY" ]; then
  echo "   FAIL: Key rotation failed. Response: $ROTATE_RESPONSE"
  exit 1
fi

echo "   New Key: ${NEW_KEY:0:10}..."

# 4. Verify old key is rejected
echo "4. Verifying old key is rejected..."
OLD_KEY_RESPONSE=$(curl -s -X GET "$BASE_URL/api/v1/projects" \
  -H "X-API-Key: $AGENT_KEY")

if echo "$OLD_KEY_RESPONSE" | grep -q '"error"'; then
  echo "   PASS: Old key rejected"
else
  echo "   FAIL: Old key still works. Response: $OLD_KEY_RESPONSE"
  exit 1
fi

# 5. Verify new key works
echo "5. Verifying new key works..."
NEW_KEY_RESPONSE=$(curl -s -X GET "$BASE_URL/api/v1/projects" \
  -H "X-API-Key: $NEW_KEY")

if echo "$NEW_KEY_RESPONSE" | grep -q '"success":true\|"projects"'; then
  echo "   PASS: New key is valid"
else
  echo "   FAIL: New key not working. Response: $NEW_KEY_RESPONSE"
  exit 1
fi

echo ""
echo "PASS: API key rotation integration test complete"
