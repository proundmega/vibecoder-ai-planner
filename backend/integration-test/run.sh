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
set -uo pipefail

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

# ── Source all test suites ────────────────────────────────────────────────────
SUITES_DIR="$ROOT/integration-test/suites"
for suite_file in "$SUITES_DIR"/*.test.sh; do
  source "$suite_file"
done

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  # Set INTEGRATION_TESTS=1 BEFORE any docker compose commands to disable rate limiting
  export INTEGRATION_TESTS=1

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

  # Auto-discover test functions from suite files
  for suite_file in "$SUITES_DIR"/*.test.sh; do
    base=$(basename "$suite_file" .test.sh)
    func_name="test_${base}"
    
    # Try exact match first, then check if any test_* function is defined in this file
    if declare -f "$func_name" > /dev/null 2>&1; then
      echo ""
      echo "--- Running: $base ---"
      $func_name
    else
      # Find the actual test function name defined in this suite file
      actual_func=$(grep -oP '^\s*test_\w+\(\)' "$suite_file" | head -1 | tr -d ' ()')
      if [ -n "$actual_func" ] && declare -f "$actual_func" > /dev/null 2>&1; then
        echo ""
        echo "--- Running: $base (as $actual_func) ---"
        $actual_func
      else
        echo ""
        echo "--- Skipping: $base (no test function found) ---"
      fi
    fi
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
