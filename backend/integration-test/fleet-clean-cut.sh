#!/usr/bin/env bash
# fg-54 joint clean-cut verification.
#
# Runs inside the integration test container (or any checkout with the backend
# dependencies installed). It applies the destructive 057 clean cut through the
# opt-in switch and then requires the manager/lease integration suite to run:
# a missing fleet schema is a failure, not a skip.
#
# Usage (fresh database):
#   DATABASE_URL=postgresql://... AGENT_FLEET_CLEAN_CUT=1 \
#   REQUIRE_FLEET_SCHEMA=1 bash integration-test/fleet-clean-cut.sh
#
# From the repository root, point it at the backend directory first:
#   (cd backend && DATABASE_URL=... bash integration-test/fleet-clean-cut.sh)

set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL is required for the clean-cut verification}"

export AGENT_FLEET_CLEAN_CUT=1
export REQUIRE_FLEET_SCHEMA=1

echo "=== fg-54 clean cut: applying 057 on a fresh database ==="
node src/migrations/apply.js

echo "=== fg-54 clean cut: manager/lease integration (schema required) ==="
./node_modules/.bin/jest --config jest.integration.config.js \
  src/__tests__/integration/managerFleet.integration.test.js \
  --runInBand
