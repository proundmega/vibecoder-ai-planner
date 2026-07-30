#!/usr/bin/env bash
# Jenkins CI Docker diagnostics — logs Docker connectivity info for debugging
# Usage: scripts/jenkins-docker-diagnose.sh
set -euo pipefail

echo "=== DOCKER DIAGNOSTICS ==="
echo "DOCKER_HOST=$DOCKER_HOST"
echo "DOCKER_TLS_VERIFY=${DOCKER_TLS_VERIFY:-not set}"
echo "DOCKER_CERT_PATH=${DOCKER_CERT_PATH:-not set}"
echo ""
echo "docker version:"
docker version 2>&1 || true
echo ""
echo "docker compose version:"
docker compose version 2>&1 || true
echo ""
echo "Testing docker CLI connectivity:"
docker ps --format "{{.ID}} {{.Names}} {{.Status}}" 2>&1 | head -20 || true
echo ""
echo "DNS resolution for docker-socket-proxy:"
getent hosts docker-socket-proxy 2>&1 || true
nslookup docker-socket-proxy 2>&1 || true
dig docker-socket-proxy 2>&1 || true
echo ""
echo "Resolving via host file:"
grep docker /etc/hosts 2>&1 || true
echo ""
echo "Docker internal DNS servers:"
cat /etc/resolv.conf 2>&1 || true
echo ""
echo "Docker gateway (bridge network):"
ip route | grep default 2>&1 || true
echo ""
echo "Testing docker compose connectivity (will show error if broken):"
DOCKER_HOST=$DOCKER_HOST docker compose ps 2>&1 || true
echo "=== END DOCKER DIAGNOSTICS ==="
