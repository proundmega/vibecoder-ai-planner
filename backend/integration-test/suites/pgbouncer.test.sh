#!/usr/bin/env bash
# PgBouncer integration tests (skipped — PgBouncer removed in favor of direct PG connection)

test_pgbouncer() {
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  PgBouncer"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # PgBouncer was removed from the stack (PostgreSQL 17 scram-sha-256 incompatibility)
  # API now connects directly to postgres:5432
  echo "SKIPPED: PgBouncer removed — API connects directly to PostgreSQL"
  pass "PgBouncer skipped (removed from stack)"
}
test_pgbouncer
