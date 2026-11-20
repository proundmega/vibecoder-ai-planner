#!/usr/bin/env bash
# Run the same Node/Java checks that gate a pull request in Jenkins.
#
# Usage: bash scripts/verify-local.sh [--quick] [--coverage]
#   --quick     skip coverage and the Java agent tests
#   --coverage  also enforce the 60% coverage thresholds (implied unless --quick)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUICK=0
COVERAGE=1
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1; COVERAGE=0 ;;
    --coverage) COVERAGE=1 ;;
    -h|--help)
      echo "Usage: $0 [--quick] [--coverage]"
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      exit 1
      ;;
  esac
done

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
case "$ACTUAL_NODE" in
  "$EXPECTED_NODE".*) ;;
  *)
    echo "Node $ACTUAL_NODE is active; .nvmrc requires $EXPECTED_NODE.x" >&2
    echo "Run 'nvm use' (or scripts/bootstrap-local.sh) first." >&2
    exit 1
    ;;
esac

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
echo "Local verification passed."
