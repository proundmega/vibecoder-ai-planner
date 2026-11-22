#!/usr/bin/env bash
# Hermetic tests for agent/scripts/host-storage.sh (fg-44).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STORAGE="$SCRIPT_DIR/host-storage.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
REPO="$TMP_DIR/repos"
PID_DIR="$TMP_DIR/pids"
TMP_ROOT="$TMP_DIR/tmp"
mkdir -p "$REPO/runtimes/12/34/repo" "$PID_DIR" "$TMP_ROOT"
touch -d '30 hours ago' "$REPO/runtimes/12"

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1" >&2; }
run() {
    env AGENT_REPO_DIR="$REPO" SUPERVISOR_PID_DIR="$PID_DIR" AGENT_TMPDIR="$TMP_ROOT" \
        bash "$STORAGE" "$@"
}

if run --dry-run >"$TMP_DIR/dry.out" 2>&1; then pass "dry-run succeeds"; else fail "dry-run succeeds"; fi
[[ -d "$REPO/runtimes/12" ]] && pass "dry-run keeps the runtime root" || fail "dry-run keeps the runtime root"

if run --apply >"$TMP_DIR/apply.out" 2>&1; then pass "apply succeeds"; else fail "apply succeeds"; fi
[[ ! -e "$REPO/runtimes/12" ]] && pass "apply removes the old runtime root" || fail "apply removes the old runtime root"

mkdir -p "$REPO/runtimes/12/34/repo"
touch "$REPO/runtimes/12/34/.active"
if run --apply >/dev/null 2>&1; then
    fail "apply refuses a live .active marker"
else
    code=$?
    [[ "$code" -eq 4 ]] && pass "apply refuses a live .active marker" || fail "apply refuses a live .active marker (got $code)"
fi
rm -f "$REPO/runtimes/12/34/.active"

touch "$PID_DIR/worker.pid"
if run --apply >/dev/null 2>&1; then
    fail "apply refuses a live supervisor PID"
else
    code=$?
    [[ "$code" -eq 4 ]] && pass "apply refuses a live supervisor PID" || fail "apply refuses a live supervisor PID (got $code)"
fi
rm -f "$PID_DIR/worker.pid"

# Legacy and temp fixtures.
mkdir -p "$REPO/abcdef12-repo" "$TMP_ROOT/opencode-harness-x" "$TMP_ROOT/vibecode-askpass-y"
touch -d '30 hours ago' "$REPO/abcdef12-repo" "$TMP_ROOT/opencode-harness-x" "$TMP_ROOT/vibecode-askpass-y"
if run --apply --legacy >/dev/null 2>&1; then pass "legacy apply succeeds"; else fail "legacy apply succeeds"; fi
[[ ! -e "$REPO/abcdef12-repo" ]] && pass "legacy removes the old random clone" || fail "legacy removes the old random clone"
[[ ! -e "$TMP_ROOT/opencode-harness-x" ]] && pass "legacy removes opencode temp dirs" || fail "legacy removes opencode temp dirs"
[[ ! -e "$TMP_ROOT/vibecode-askpass-y" ]] && pass "legacy removes askpass temp dirs" || fail "legacy removes askpass temp dirs"

JSON="$(run --dry-run --json 2>/dev/null || true)"
if [[ "$JSON" == \{*'"removed"'* ]]; then pass "--json prints a machine summary"; else fail "--json prints a machine summary"; fi

if run --bogus >/dev/null 2>&1; then fail "unknown option fails"; else
    code=$?
    [[ "$code" -eq 2 ]] && pass "unknown option exits 2" || fail "unknown option exits 2 (got $code)"
fi

if [[ "$FAIL" -ne 0 ]]; then
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL" >&2
    exit 1
fi
printf '\n%d passed, 0 failed\n' "$PASS"
