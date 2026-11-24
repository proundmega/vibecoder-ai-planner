#!/usr/bin/env bash
# Run the local Node/Java checks used before a pull request.
#
# This is not the full Jenkins pipeline: it does not run Docker integration,
# Cypress e2e/component tests, agent packaging/image builds or sandbox checks.
#
# Usage: bash scripts/verify-local.sh [--quick | --coverage | --agent]
#   --quick     skip coverage and the Java agent tests
#   --coverage  enforce the 60% coverage thresholds (implied unless --quick)
#   --agent     install missing deps, run only changed layers and require a
#               changed/new test file (used by the coding harness)
set -euo pipefail

ROOT="${VERIFY_LOCAL_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$ROOT"

QUICK=0
COVERAGE=1
COVERAGE_SET=0
AGENT=0
for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1; COVERAGE=0 ;;
    --coverage) COVERAGE=1; COVERAGE_SET=1 ;;
    --agent) AGENT=1 ;;
    -h|--help)
      echo "Usage: $0 [--quick | --coverage | --agent]"
      echo "  --quick     skip coverage and the Java agent tests"
      echo "  --coverage  enforce coverage (implied unless --quick)"
      echo "  --agent     run only changed layers and require changed/new tests"
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
if [ "$AGENT" -eq 1 ] && { [ "$QUICK" -eq 1 ] || [ "$COVERAGE_SET" -eq 1 ]; }; then
  echo "error: --agent cannot be combined with --quick or --coverage" >&2
  exit 2
fi

if [ "${VERIFY_AGENT_DRY_RUN:-0}" != "1" ]; then
  NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    # shellcheck disable=SC1091
    . "$NVM_DIR/nvm.sh"
    nvm use --silent >/dev/null 2>&1 || true
  fi

  # Optional user-local JDK/Maven (agent toolchain), not installed here.
  if [ -d "$HOME/.local/opt/jdk-17" ]; then
    export JAVA_HOME="$HOME/.local/opt/jdk-17"
    export PATH="$JAVA_HOME/bin:$PATH"
  fi
  if [ -d "$HOME/.local/opt/maven" ]; then
    export PATH="$HOME/.local/opt/maven/bin:$PATH"
  fi
fi

if [ "${VERIFY_AGENT_DRY_RUN:-0}" != "1" ]; then
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
fi

step() {
  echo
  echo "==> $*"
}

changed_paths() {
  {
    git -C "$ROOT" diff --name-only --diff-filter=ACMRD
    git -C "$ROOT" diff --cached --name-only --diff-filter=ACMRD
    git -C "$ROOT" ls-files --others --exclude-standard
  } | sed '/^[[:space:]]*$/d' | sort -u
}

deleted_paths() {
  {
    git -C "$ROOT" diff --name-only --diff-filter=D
    git -C "$ROOT" diff --cached --name-only --diff-filter=D
  } | sed '/^[[:space:]]*$/d' | sort -u
}

ensure_npm_deps() {
  local dir="$1" bin="$2"
  if [ ! -x "$ROOT/$dir/node_modules/.bin/$bin" ]; then
    echo "==> Installing $dir dependencies"
    (cd "$ROOT/$dir" && npm ci --prefer-offline --no-audit --no-fund)
  fi
}

run_agent_mode() {
  local -a changed=()
  mapfile -t changed < <(changed_paths)
  if [ "${#changed[@]}" -eq 0 ]; then
    echo "error: --agent found no changed or new files" >&2
    return 1
  fi

  local -A deleted=()
  local path
  while IFS= read -r path; do
    [ -n "$path" ] && deleted["$path"]=1
  done < <(deleted_paths)

  local backend=0 frontend=0 agent=0 scripts=0 planning=0 shared=0
  local backend_test=0 frontend_test=0 agent_test=0 scripts_test=0
  for path in "${changed[@]}"; do
    case "$path" in
      planning/*) planning=1 ;;
      docs/*|*.md|README*|AGENTS.md|FUTURE_IDEAS.txt|PENDING.txt|tickets.txt|DREAM*|.gitignore|LICENSE) ;;
      backend/*) backend=1 ;;
      frontend/*) frontend=1 ;;
      agent/*) agent=1 ;;
      scripts/*) scripts=1 ;;
      *) shared=1 ;;
    esac
    if [ -z "${deleted[$path]:-}" ]; then
      case "$path" in
        backend/*.test.js|backend/*.test.ts|backend/*.test.sh) backend_test=1 ;;
        frontend/*.test.js|frontend/*.test.ts|frontend/*.test.tsx|frontend/*.cy.js|frontend/*.cy.ts) frontend_test=1 ;;
        agent/*Test.java|agent/*.test.sh) agent_test=1 ;;
        scripts/*.test.sh) scripts_test=1 ;;
      esac
    fi
  done

  if [ "$backend" -eq 1 ] && [ "$backend_test" -eq 0 ]; then
    echo "error: --agent requires a changed/new backend test (backend/src/__tests__, backend/src/middleware or backend/*.test.sh)" >&2
    return 1
  fi
  if [ "$frontend" -eq 1 ] && [ "$frontend_test" -eq 0 ]; then
    echo "error: --agent requires a changed/new frontend test (frontend/src/__tests__ or frontend/cypress)" >&2
    return 1
  fi
  if [ "$agent" -eq 1 ] && [ "$agent_test" -eq 0 ]; then
    echo "error: --agent requires a changed/new agent test (agent/src/test or agent/*.test.sh)" >&2
    return 1
  fi
  if [ "$scripts" -eq 1 ] && [ "$scripts_test" -eq 0 ]; then
    echo "error: --agent requires a changed/new scripts/*.test.sh for a scripts-only change" >&2
    return 1
  fi
  if [ "$shared" -eq 1 ] && [ "$backend_test" -eq 0 ] && [ "$frontend_test" -eq 0 ] \
      && [ "$agent_test" -eq 0 ] && [ "$scripts_test" -eq 0 ]; then
    echo "error: --agent requires a changed/new test file for a shared root change" >&2
    return 1
  fi

  local -a layers=()
  if [ "$backend" -eq 1 ] || [ "$shared" -eq 1 ]; then layers+=(backend); fi
  if [ "$frontend" -eq 1 ] || [ "$shared" -eq 1 ]; then layers+=(frontend); fi
  if [ "$agent" -eq 1 ] || [ "$shared" -eq 1 ]; then layers+=(agent); fi
  if [ "$scripts" -eq 1 ]; then layers+=(scripts); fi
  if [ "$planning" -eq 1 ]; then layers+=(planning); fi

  if [ "${#layers[@]}" -eq 0 ]; then
    echo "error: --agent found no runnable layer (only docs changed)" >&2
    return 1
  fi

  if [ "${VERIFY_AGENT_DRY_RUN:-0}" = "1" ]; then
    echo "agent verification plan"
    echo "changed: ${changed[*]}"
    echo "layers: ${layers[*]}"
    echo "tests: backend=$backend_test frontend=$frontend_test agent=$agent_test scripts=$scripts_test"
    return 0
  fi

  for layer in "${layers[@]}"; do
    case "$layer" in
      backend)
        ensure_npm_deps backend jest
        (cd "$ROOT/backend" && npm run lint && node --check src/index.js \
          && bash integration-test/helpers_unit.test.sh && npm test)
        for path in "${changed[@]}"; do
          case "$path" in
            backend/*.test.sh) (cd "$ROOT" && bash "$path") ;;
          esac
        done
        ;;
      frontend)
        ensure_npm_deps frontend vitest
        (cd "$ROOT/frontend" && npm run lint && npm run typecheck \
          && npm test -- --run && npm run build)
        ;;
      agent)
        if ! command -v mvn >/dev/null 2>&1; then
          echo "error: --agent needs Maven for the changed agent layer" >&2
          return 3
        fi
        (cd "$ROOT/agent" && mvn -B test)
        for path in "${changed[@]}"; do
          case "$path" in
            agent/*.test.sh) (cd "$ROOT" && bash "$path") ;;
          esac
        done
        ;;
      scripts)
        for path in "${changed[@]}"; do
          case "$path" in
            scripts/*.test.sh) (cd "$ROOT" && bash "$path") ;;
          esac
        done
        ;;
      planning)
        (cd "$ROOT" && node planning/check-planning.js)
        ;;
    esac
  done

  if [ "$backend" -eq 1 ] || [ "$frontend" -eq 1 ] || [ "$shared" -eq 1 ]; then
    ensure_npm_deps frontend vitest
    (cd "$ROOT/frontend" && ./node_modules/.bin/vitest --run src/__tests__/api-contract.test.ts)
  fi
}

if [ "$AGENT" -eq 1 ]; then
  run_agent_mode
  exit $?
fi

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

step "Agent verification gate tests"
bash scripts/verify-local-agent.test.sh

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
