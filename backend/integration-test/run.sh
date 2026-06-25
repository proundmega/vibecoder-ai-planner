#!/usr/bin/env bash
# Full integration test suite — runs against real Docker containers + real PostgreSQL.
# Usage: ./run.sh          (brings up docker compose first)
#        ./run.sh --only   (skips docker compose up, assumes services already running)
#
# Test suites are split into individual files under suites/ for easy editing:
#   health.test.sh          — Health & version checks
#   auth.test.sh            — Registration, login, token validation
#   projects.test.sh        — Project CRUD
#   tickets.test.sh         — Ticket CRUD
#   status_transitions.test.sh  — Valid/invalid status transitions
#   agents.test.sh          — AI agent endpoints
#   frontend.test.sh        — Frontend SPA serving
#   frontend_proxy.test.sh  — API proxy via frontend
#   route_ordering.test.sh  — Route precedence (tickets vs project)
#   user_role_access.test.sh    — User role ticket access
#   user_management.test.sh     — Role-based user management
#   ticket_permissions.test.sh  — Role-based ticket permissions
#   approvals.test.sh         — Approval workflow
#   jwt_expiry.test.sh        — JWT token expiry validation
#   frontend_crud.test.sh     — Ticket CRUD via /api/tickets
#   credentials.test.sh       — Secure API key management
#   ticket_ownership.test.sh  — Ticket pickup/release for agents
#   usage_tracking.test.sh    — Usage logging & model pricing
#   billing.test.sh           — Billing aggregation
#   agent_memory.test.sh      — Shared agent memory (pgvector)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="http://localhost:3001"
RETRIES=30
RETRY_INTERVAL=2

# ── Source helpers ────────────────────────────────────────────────────────────
source "$ROOT/integration-test/helpers.sh"

# ── Source all test suites ────────────────────────────────────────────────────
SUITES_DIR="$ROOT/integration-test/suites"
for suite_file in "$SUITES_DIR"/*.test.sh; do
  source "$suite_file"
done

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  local skip_start=false
  if [[ "${1:-}" == "--only" ]]; then
    skip_start=true
  fi

  if ! $skip_start; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Starting Docker Compose"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cd "$ROOT"
    sudo docker compose down --remove-orphans 2>/dev/null || true
    sudo docker compose build api 2>&1 | tail -3
    sudo docker compose up -d 2>&1 | tail -5
  fi

  wait_for_api
  clean_db

  # Set INTEGRATION_TESTS=1 to disable rate limiting for integration tests
  cd "$ROOT"
  grep -q 'INTEGRATION_TESTS' docker-compose.override.yml 2>/dev/null || \
    sed -i '/NODE_ENV=development/a\      - INTEGRATION_TESTS=1' docker-compose.override.yml 2>/dev/null || true
  sudo docker compose up -d --force-recreate api 2>&1 | tail -3
  sleep 8

  # Allow frontend nginx to resolve the api hostname
  sleep 3
  sudo docker restart vibecode-frontend 2>/dev/null || true
  sleep 3

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Jest Integration Tests (PostgreSQL)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$ROOT"
  DATABASE_URL="postgresql://postgres:changeme@localhost:5432/vibecode" npx jest --config jest.integration.config.js --verbose 2>&1 | tail -20
  JEST_EXIT=${PIPESTATUS[0]}
  if [ "$JEST_EXIT" -ne 0 ]; then
    echo ""
    echo "FAILED: Jest integration tests exited with code $JEST_EXIT"
    exit 1
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Integration Test Suite (curl + Docker)"
  echo "  $(date '+%Y-%m-%d %H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  test_health
  test_auth
  test_projects
  test_tickets
  test_status_transitions
  test_agents
  test_user_role_ticket_access
  test_route_ordering
  test_ticket_crud_via_frontend_endpoint
  test_frontend_api_proxy
  test_role_based_user_management
  test_role_based_ticket_permissions
  test_approvals_api
  test_jwt_token_expiry
  test_credentials
  test_ticket_ownership
  test_usage_tracking
  test_billing
  test_shared_agent_memory
  test_frontend

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Results: $PASS passed, $FAIL failed, $((PASS + FAIL)) total"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  for t in "${TESTS[@]}"; do
    echo "  $t"
  done

  if [ "$FAIL" -gt 0 ]; then
    echo ""
    echo "FAILED: $FAIL test(s) failed"
    exit 1
  else
    echo ""
    echo "ALL TESTS PASSED"
    exit 0
  fi
}

main "$@"
