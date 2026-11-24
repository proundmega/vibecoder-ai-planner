#!/usr/bin/env bash
# Hermetic tests for scripts/verify-local.sh --agent (FLOW-0).
#
# The plan never executes npm/Maven: VERIFY_AGENT_DRY_RUN prints the detected
# layers and tests so the gate can be tested in a temp repo.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="$SCRIPT_DIR/verify-local.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git init -q "$TMP"
git -C "$TMP" config user.email "test@example.com"
git -C "$TMP" config user.name "Test"
git -C "$TMP" commit -q --allow-empty -m init
BASE="$(git -C "$TMP" rev-parse HEAD)"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1" >&2; }

run_plan() {
    VERIFY_LOCAL_ROOT="$TMP" VERIFY_AGENT_DRY_RUN=1 bash "$VERIFY" --agent "$@" 2>&1
}

reset_fixture() {
    git -C "$TMP" reset --hard -q "$BASE"
    git -C "$TMP" clean -fdq
}

make() {
    mkdir -p "$TMP/$(dirname "$1")"
    printf 'fixture\n' > "$TMP/$1"
}

expect_layers() {
    local description="$1" layers="$2"
    local out
    if out="$(run_plan)"; then
        if grep -Fq "layers: $layers" <<<"$out"; then
            pass "$description"
        else
            fail "$description (got: $out)"
        fi
    else
        fail "$description (exit $?)"
    fi
    reset_fixture
}

expect_fail() {
    local description="$1" expected="$2" message="$3"
    local out code
    set +e
    out="$(run_plan)"
    code=$?
    set -e
    if [ "$code" -eq "$expected" ] && grep -Fq "$message" <<<"$out"; then
        pass "$description"
    else
        fail "$description (exit $code, got: $out)"
    fi
    reset_fixture
}

make backend/src/app.js
make backend/src/__tests__/app.test.js
expect_layers "backend production + test plans the backend layer" backend

make backend/src/middleware/permissions.js
make backend/src/middleware/permissions.test.js
expect_layers "middleware tests are valid backend evidence" backend

make frontend/src/App.vue
make frontend/src/__tests__/App.test.ts
expect_layers "frontend production + test plans the frontend layer" frontend

make frontend/src/App.vue
make frontend/cypress/e2e/app.cy.ts
expect_layers "Cypress tests are valid frontend evidence" frontend

make agent/src/main/java/com/vibecode/agent/App.java
make agent/src/test/java/com/vibecode/agent/AppTest.java
expect_layers "agent production + test plans the agent layer" agent

make scripts/example.test.sh
expect_layers "a scripts test plans the scripts layer" scripts

make planning/THREE_WORKER_PLANS.md
expect_layers "planning-only changes run the planning check" planning

make agent/README.md
make backend/src/__tests__/app.test.js
expect_layers "nested docs do not force the agent layer" backend

make README.md
make backend/src/__tests__/app.test.js
expect_layers "docs next to a backend test stay backend-only" backend

make Jenkinsfile
make backend/src/__tests__/app.test.js
expect_layers "a shared root code change plans every code layer" "backend frontend agent"

make README.md
make scripts/example.test.sh
expect_layers "docs next to a scripts test stay scripts-only" scripts

make backend/src/app.js
expect_fail "a backend change without a backend test fails" 1 "requires a changed/new backend test"

make backend/src/app.js
make frontend/src/__tests__/App.test.ts
expect_fail "a frontend test does not cover a backend change" 1 "requires a changed/new backend test"

make scripts/example.sh
make backend/src/__tests__/app.test.js
expect_fail "a backend test does not cover a scripts change" 1 "requires a changed/new scripts/*.test.sh"

make scripts/example.sh
expect_fail "a scripts-only change without a scripts test fails" 1 "requires a changed/new scripts/*.test.sh"

make agent/README.md
expect_fail "docs-only agent changes fail" 1 "found no runnable layer"

make README.md
expect_fail "README-only changes fail" 1 "found no runnable layer"

# A deleted test is not evidence.
make backend/src/__tests__/deleted.test.js
git -C "$TMP" add backend/src/__tests__/deleted.test.js
git -C "$TMP" commit -q -m "add test"
make backend/src/app.js
rm "$TMP/backend/src/__tests__/deleted.test.js"
expect_fail "a deleted test does not satisfy the gate" 1 "requires a changed/new backend test"

expect_fail "no changes fails" 1 "found no changed or new files"

if run_plan --quick >/dev/null 2>&1; then
    fail "--agent and --quick are mutually exclusive"
else
    code=$?
    [ "$code" -eq 2 ] && pass "--agent and --quick are mutually exclusive" \
        || fail "--agent and --quick are mutually exclusive (exit $code)"
fi

if [ "$FAIL" -ne 0 ]; then
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL" >&2
    exit 1
fi
printf '\n%d passed, 0 failed\n' "$PASS"
