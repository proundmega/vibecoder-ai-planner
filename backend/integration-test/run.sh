#!/usr/bin/env bash
# Full integration test suite — runs against real Docker containers + real PostgreSQL.
# Usage: ./run.sh          (brings up docker compose first)
#        ./run.sh --only   (skips docker compose up, assumes services already running)
#        ./run.sh --list   (prints suite names without running)
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
#   agent_lifecycle.test.sh   — Agent pickup → message → release
#   agent_auth.test.sh        — X-API-Key header tests
#   rate_limiter.test.sh      — Rate limit enforcement
#   file_upload.test.sh       — Attachment upload
#   permission_matrix.test.sh — Role × endpoint matrix
#   metrics.test.sh           — Prometheus metrics endpoints
# set -o pipefail: catches pipe failures in output (e.g., grep returning 1 when no match)
# without set -e, so suites can handle failures explicitly via pass()/fail()
set -o pipefail

# ── List flag (before dependency check so it works regardless) ────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SUITES_DIR="$ROOT/integration-test/suites"
if [[ "${1:-}" == "--list" ]]; then
  echo "Available test suites:"
  for suite_file in "$SUITES_DIR"/*.test.sh; do
    basename "$suite_file" .test.sh
  done
  exit 0
fi

# ── Check dependencies ────────────────────────────────────────────────────────
command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required. Install with: apt-get install jq"; exit 1; }

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE="${BASE_URL:-http://localhost:3001}"
RETRIES=30
RETRY_INTERVAL=2

# ── Source helpers ────────────────────────────────────────────────────────────
source "$ROOT/integration-test/helpers.sh"

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  # Set INTEGRATION_TESTS=1 BEFORE any docker compose commands to disable rate limiting
  export INTEGRATION_TESTS=1

  local skip_start=false
  local verbose=false
  if [[ "${1:-}" == "--only" ]]; then
    skip_start=true
  fi
  if [[ "${1:-}" == "--verbose" ]]; then
    verbose=true
  fi

  if ! $skip_start; then
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Starting Docker Compose"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cd "$ROOT"
    docker_compose down --remove-orphans 2>/dev/null || true
    docker_compose build api 2>&1 | tail -3
    docker_compose up -d 2>&1 | tail -5
  fi

  wait_for_api
  clean_db

   docker_compose up -d --force-recreate api 2>&1 | tail -3
    sleep 8
   wait_for_api

  # Seed admin user AFTER API is ready
  ADMIN_TOKEN=$(seed_user "admin@vibecode.dev" "password123" "super_admin" "Admin")
  if [ -z "$ADMIN_TOKEN" ]; then
    echo "FATAL: Failed to seed admin user. API may be unreachable."
    exit 1
  fi
  echo "Admin token seeded: ${ADMIN_TOKEN:0:10}..."
  if $verbose; then
    # Verify user exists in database
    echo "DEBUG: Checking if admin user exists in DB..."
    if docker_exec vibecode-postgres psql -U postgres -d vibecode -t -c "SELECT id FROM users WHERE email='admin@vibecode.dev';" >/dev/null 2>&1; then
      echo "DEBUG: Admin user EXISTS in database"
    else
      echo "DEBUG: Admin user NOT FOUND in database"
    fi
  fi

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Jest Integration Tests (PostgreSQL)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$ROOT"
  npx jest --config jest.integration.config.js --verbose 2>&1 | tail -20
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

  # Source and run each test suite (suites have inline code, not function-wrapped)
  for suite_file in "$SUITES_DIR"/*.test.sh; do
    base=$(basename "$suite_file" .test.sh)
    echo ""
    echo "--- Running: $base ---"
    source "$suite_file"
  done

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
