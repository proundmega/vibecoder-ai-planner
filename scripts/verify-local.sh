#!/usr/bin/env bash
# Run the local Node/Java checks used before a pull request.
#
# This is not the full Jenkins pipeline: it does not run Docker integration,
# Cypress e2e/component tests, agent packaging/image builds or sandbox checks.
#
# Usage: bash scripts/verify-local.sh [--quick | --coverage]
#   --quick     skip coverage and the Java agent tests
#   --coverage  enforce the 60% coverage thresholds (implied unless --quick)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0
COVERAGE=1
COVERAGE_SET=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1; COVERAGE=0 ;;
    --coverage) COVERAGE=1; COVERAGE_SET=1 ;;
    -h|--help)
      echo "Usage: $0 [--quick | --coverage]"
      echo "  --quick     skip coverage and the Java agent tests"
      echo "  --coverage  enforce coverage (implied unless --quick)"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

if [ "$QUICK" -eq 1 ] && [ "$COVERAGE_SET" -eq 1 ]; then
  echo "error: --quick and --coverage are mutually exclusive" >&2
  exit 2
fi

NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$NVM_DIR/nvm.sh"
  nvm use --silent >/dev/null 2>&1 || true
fi

# Optional user-local JDK/Maven (agent toolchain), not installed by this script.
if [ -d "$HOME/.local/opt/jdk-17" ]; then
  export JAVA_HOME="$HOME/.local/opt/jdk-17"
  export PATH="$JAVA_HOME/bin:$PATH"
fi
if [ -d "$HOME/.local/opt/maven" ]; then
  export PATH="$HOME/.local/opt/maven/bin:$PATH"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node was not found; run scripts/bootstrap-local.sh first" >&2
  exit 1
fi

EXPECTED_NODE="$(tr -d '[:space:]' < .nvmrc)"
ACTUAL_NODE="$(node -p 'process.versions.node')"
if [[ "$EXPECTED_NODE" == *.*.* ]]; then
  NODE_MATCH=0
  [ "$ACTUAL_NODE" = "$EXPECTED_NODE" ] && NODE_MATCH=1
else
  NODE_MATCH=0
  [[ "$ACTUAL_NODE" == "$EXPECTED_NODE".* ]] && NODE_MATCH=1
fi
if [ "$NODE_MATCH" -eq 0 ]; then
  echo "Node $ACTUAL_NODE is active; .nvmrc requires $EXPECTED_NODE" >&2
  echo "Run 'nvm use' (or scripts/bootstrap-local.sh) first." >&2
  exit 1
fi

step() {
  echo
  echo "==> $*"
}

step "Backend lint"
(cd backend && npm run lint)

step "Backend syntax"
(cd backend && node --check src/index.js)

step "Backend helper unit tests"
(cd backend && bash integration-test/helpers_unit.test.sh)

step "Backend unit tests"
(cd backend && npm test)

if [ "$COVERAGE" -eq 1 ]; then
  step "Backend coverage"
  (cd backend && npm run test:coverage)
fi

step "Frontend lint"
(cd frontend && npm run lint)

step "Frontend typecheck"
(cd frontend && npm run typecheck)

step "Frontend unit tests"
(cd frontend && npm test -- --run)

if [ "$COVERAGE" -eq 1 ]; then
  step "Frontend coverage"
  (cd frontend && npm test -- --run --coverage)
fi

step "Frontend build"
(cd frontend && npm run build)

step "API contract test"
(cd frontend && ./node_modules/.bin/vitest --run src/__tests__/api-contract.test.ts)

step "Planning check"
node planning/check-planning.js

if [ "$QUICK" -eq 0 ]; then
  if command -v mvn >/dev/null 2>&1; then
    step "Java agent tests"
    (cd agent && mvn -B test)
  else
    echo
    echo "Skipping Java agent tests: mvn not found (optional)."
  fi
fi

echo
echo "Local verification passed (Node/Java checks only)."
echo "Not covered: Docker integration, Cypress e2e/component, agent packaging/image, sandbox checks."
