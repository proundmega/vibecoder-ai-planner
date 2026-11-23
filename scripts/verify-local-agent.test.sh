#!/usr/bin/env bash
# Hermetic tests for scripts/verify-local.sh --agent (FLOW-0).
#
# The plan never executes the npm/Maven commands: VERIFY_AGENT_DRY_RUN prints
# the detected layers and tests so the gate can be tested in a temp repo.
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
VERIFY="$SCRIPT_DIR/verify-local.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

git init -q "$TMP"
git -C "$TMP" config user.email "test@example.com"
git -C "$TMP" config user.name "Test"
git -C "$TMP" commit -q --allow-empty -m init

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1" >&2; }

run_plan() {
    VERIFY_LOCAL_ROOT="$TMP" VERIFY_AGENT_DRY_RUN=1 bash "$VERIFY" --agent "$@" 2>&1
}

clean_fixture() {
    git -C "$TMP" clean -fdq
}

make() {
    mkdir -p "$TMP/$(dirname "$1")"
    printf 'fixture\n' > "$TMP/$1"
}

expect_layers() {
    local description="$1" layers="$2" test_flag="$3"
    local out
    if out="$(run_plan)"; then
        if grep -Fq "layers: $layers" <<<"$out" \
            && grep -Fq "code-test: $test_flag" <<<"$out"; then
            pass "$description"
        else
            fail "$description (got: $out)"
        fi
    else
        fail "$description (exit $?)"
    fi
    clean_fixture
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
    clean_fixture
}

make backend/src/app.js
make backend/src/__tests__/app.test.js
expect_layers "backend production + test plans the backend layer" backend 1

make frontend/src/App.vue
make frontend/src/__tests__/App.test.ts
expect_layers "frontend production + test plans the frontend layer" frontend 1

make agent/src/main/java/com/vibecode/agent/App.java
make agent/src/test/java/com/vibecode/agent/AppTest.java
expect_layers "agent production + test plans the agent layer" agent 1

make scripts/example.test.sh
expect_layers "a scripts test plans the scripts layer" scripts 0

make README.md
make backend/src/__tests__/app.test.js
expect_layers "docs next to a backend test stay backend-only" backend 1

make Jenkinsfile
make backend/src/__tests__/app.test.js
expect_layers "a shared root code change plans every code layer" "backend frontend agent" 1

make README.md
make scripts/example.test.sh
expect_layers "docs next to a scripts test stay scripts-only" scripts 0

make backend/src/app.js
expect_fail "a backend change without a test fails" 1 "requires a changed/new test file"

make scripts/example.sh
expect_fail "a scripts-only change without a scripts test fails" 1 "requires a changed/new scripts/*.test.sh"

make README.md
expect_fail "README-only changes fail" 1 "found no runnable layer"
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
