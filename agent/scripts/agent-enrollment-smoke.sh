#!/usr/bin/env bash
# fg-54 node enrollment smoke test: first boot enrolls, the credential file is
# 0600, and a restart with the same volume does not enroll again.
#
# Requires a running backend and a join token minted in the UI:
#   BACKEND_URL=https://planner.example.com \
#   ENROLLMENT_TOKEN=enr_... \
#   bash agent/scripts/agent-enrollment-smoke.sh
#
# Optional: AGENT_IMAGE, AGENT_NODE_NAME, AGENT_RUNTIME_ID, AGENT_ROLE and
# AGENT_LLM_MODEL (the direct-run runtime fields; a supervisor normally sets them).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
: "${BACKEND_URL:?set BACKEND_URL}"
: "${ENROLLMENT_TOKEN:?mint a join token in Fleet -> Mint token}"

AGENT_IMAGE="${AGENT_IMAGE:-vibecode-agent:fg54-smoke}"
CONTAINER="vibecode-agent-fg54-smoke"
VOLUME="vibecode-agent-fg54-smoke-credentials"
AGENT_NODE_NAME="${AGENT_NODE_NAME:-fg54-smoke}"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Building agent image..."
docker build -t "$AGENT_IMAGE" "$ROOT" >/dev/null

# Start with a clean identity so the first boot really enrolls.
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker volume rm "$VOLUME" >/dev/null 2>&1 || true

run_agent() {
  local with_token="${1:-true}"
  local extra=()
  [ -n "${PROJECT_ID:-}" ] && extra+=(-e "PROJECT_ID=$PROJECT_ID")
  [ -n "${AGENT_RUNTIME_ID:-}" ] && extra+=(-e "AGENT_RUNTIME_ID=$AGENT_RUNTIME_ID")
  [ -n "${AGENT_ROLE:-}" ] && extra+=(-e "AGENT_ROLE=$AGENT_ROLE")
  [ -n "${AGENT_LLM_MODEL:-}" ] && extra+=(-e "AGENT_LLM_MODEL=$AGENT_LLM_MODEL")
  # The second boot deliberately omits the join token so success proves the
  # credential file, not the (still valid) token, is what authorized it.
  [ "$with_token" = "true" ] && extra+=(-e "ENROLLMENT_TOKEN=$ENROLLMENT_TOKEN")
  docker run -d --name "$CONTAINER" \
    -e "BACKEND_URL=$BACKEND_URL" \
    "${extra[@]}" \
    -e "AGENT_CREDENTIALS_FILE=/credentials/node.json" \
    -e "AGENT_NODE_NAME=$AGENT_NODE_NAME" \
    -v "$VOLUME:/credentials" \
    "$AGENT_IMAGE" >/dev/null
}

echo "First boot (expected: enroll)..."
run_agent true
sleep 15
mode=$(docker exec "$CONTAINER" stat -c '%a' /credentials/node.json)
if [ "$mode" != "600" ]; then
  echo "FAIL: credential file mode is $mode, expected 600"
  docker logs "$CONTAINER" | tail -20
  exit 1
fi
if ! docker exec "$CONTAINER" grep -q '"refreshToken"' /credentials/node.json; then
  echo "FAIL: credential file has no refresh token"
  exit 1
fi
first_agent_id=$(docker exec "$CONTAINER" jq -r '.nodeId // empty' /credentials/node.json)
if [ -z "$first_agent_id" ]; then
  echo "FAIL: credential file has no nodeId"
  exit 1
fi
first_logs=$(docker logs "$CONTAINER" 2>&1)
if echo "$first_logs" | grep -q "$ENROLLMENT_TOKEN"; then
  echo "FAIL: enrollment token leaked into logs"
  exit 1
fi
docker rm -f "$CONTAINER" >/dev/null

echo "Restart with the same volume and NO token (expected: file wins)..."
run_agent false
sleep 10
if [ "$(docker inspect -f '{{.State.Running}}' "$CONTAINER")" != "true" ]; then
  echo "FAIL: container exited without a join token"
  docker logs "$CONTAINER" | tail -20
  exit 1
fi
second_agent_id=$(docker exec "$CONTAINER" jq -r '.nodeId // empty' /credentials/node.json)
if [ "$second_agent_id" != "$first_agent_id" ]; then
  echo "FAIL: node identity changed (${first_agent_id} -> ${second_agent_id})"
  exit 1
fi
if docker logs "$CONTAINER" 2>&1 | grep -q "No credential file and no ENROLLMENT_TOKEN"; then
  echo "FAIL: restart tried to enroll instead of loading the credential file"
  exit 1
fi
docker rm -f "$CONTAINER" >/dev/null

echo "PASS: enrollment smoke test"
