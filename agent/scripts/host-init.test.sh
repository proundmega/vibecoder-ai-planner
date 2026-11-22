#!/usr/bin/env bash
# Hermetic tests for agent/scripts/host-init.sh (fg-43).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
HOST_INIT="$SCRIPT_DIR/host-init.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_contains() {
    local file="$1" needle="$2" label="$3"
    if grep -Fq -- "$needle" "$file"; then pass "$label"; else fail "$label (missing: $needle)"; fi
}
assert_not_contains() {
    local file="$1" needle="$2" label="$3"
    if [[ ! -e "$file" ]]; then pass "$label"; return; fi
    if grep -Fq -- "$needle" "$file"; then fail "$label (found: $needle)"; else pass "$label"; fi
}

cat > "$TMP_DIR/agent.ini" <<'INI'
[runtime "workers"]
role = worker
model = acme/claude-sonnet
count = 3
project = 1

[runtime "reviewers"]
role = reviewer
model = acme/claude-opus
count = 2

[runtime "planners"]
role = planner
model = acme/claude-sonnet
count = 2
INI

# 48 threads / 192 GB / 2 TB reference host: 7 runtimes = 10 CPU / 20 GB / 100 GB.
REFERENCE_ENV=(
    AGENT_INI_PATH="$TMP_DIR/agent.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/.env.agent-host"
    AGENT_HOST_CPU_THREADS=48
    AGENT_HOST_RAM_GB=192
    AGENT_HOST_DISK_GB=2000
    AGENT_REPO_DIR="$TMP_DIR"
)

DRY_OUT="$TMP_DIR/dry.out"
if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" --dry-run --explain >"$DRY_OUT" 2>&1; then
    pass "reference host dry-run succeeds"
else
    fail "reference host dry-run succeeds"
fi
assert_contains "$DRY_OUT" "Declared: 7 runtime(s)" "dry-run sees 7 runtimes"
assert_contains "$DRY_OUT" "Required: CPU 10.00" "required CPU sums role profiles"
assert_contains "$DRY_OUT" "RAM 20.00 GB" "required RAM sums role profiles"
assert_contains "$DRY_OUT" "disk 100.00 GB" "required disk sums role profiles"
assert_contains "$DRY_OUT" "Supervisor container: 21G / 10.00 cpus" "container limit includes overhead"
assert_contains "$DRY_OUT" "Formula:" "explain prints the formula"
assert_not_contains "$TMP_DIR/.env.agent-host" "AGENT_HOST_MAX_RUNTIMES" "dry-run does not write the env file"

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" --check >"$TMP_DIR/check.out" 2>&1; then
    pass "reference host check passes"
else
    fail "reference host check passes"
fi
assert_contains "$TMP_DIR/check.out" "Check passed" "check reports success"

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" >"$TMP_DIR/write.out" 2>&1; then
    pass "env file write succeeds"
else
    fail "env file write succeeds"
fi
ENV_FILE="$TMP_DIR/.env.agent-host"
assert_contains "$ENV_FILE" "AGENT_HOST_MAX_RUNTIMES=7" "writes the runtime cap"
assert_contains "$ENV_FILE" "AGENT_HOST_REQUIRED_CPUS=10.00" "writes required CPU"
assert_contains "$ENV_FILE" "SUPERVISOR_MEMORY_LIMIT=21G" "writes container memory"
assert_contains "$ENV_FILE" "SUPERVISOR_CPUS=10.00" "writes container cpus"
assert_contains "$ENV_FILE" "AGENT_LOG_MAX_SIZE=10m" "writes log rotation size"
assert_not_contains "$ENV_FILE" "POOL_ADMIN_TOKEN" "no legacy pool admin token"
assert_not_contains "$ENV_FILE" "MAX_POOL_SIZE" "no legacy pool size"

MODE="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")"
if [[ "$MODE" == "600" ]]; then pass "env file mode is 0600"; else fail "env file mode is 0600 (got $MODE)"; fi

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" >"$TMP_DIR/overwrite.out" 2>&1; then
    fail "existing env file is not overwritten without --force"
else
    pass "existing env file is not overwritten without --force"
fi
assert_contains "$TMP_DIR/overwrite.out" "--force" "overwrite error suggests --force"

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" --force >"$TMP_DIR/force.out" 2>&1; then
    pass "--force overwrites the env file"
else
    fail "--force overwrites the env file"
fi

OVER_ENV=(
    AGENT_INI_PATH="$TMP_DIR/agent.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/over.env"
    AGENT_HOST_CPU_THREADS=4
    AGENT_HOST_RAM_GB=8
    AGENT_HOST_DISK_GB=50
    AGENT_REPO_DIR="$TMP_DIR"
)
if env "${OVER_ENV[@]}" bash "$HOST_INIT" --dry-run >"$TMP_DIR/over.out" 2>&1; then
    fail "over-capacity declaration fails closed"
else
    pass "over-capacity declaration fails closed"
fi
assert_contains "$TMP_DIR/over.out" "Host capacity check failed" "failure explains the capacity breach"
assert_contains "$TMP_DIR/over.out" "CPU: need" "failure names the CPU constraint"
if [[ -e "$TMP_DIR/over.env" ]]; then fail "over-capacity writes no env file"; else pass "over-capacity writes no env file"; fi

if env "${OVER_ENV[@]}" bash "$HOST_INIT" --check >"$TMP_DIR/over-check.out" 2>&1; then
    fail "over-capacity --check fails"
else
    pass "over-capacity --check fails"
fi

OVERRIDE_ENV=(
    AGENT_INI_PATH="$TMP_DIR/agent.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/override.env"
    AGENT_HOST_CPU_THREADS=48
    AGENT_HOST_RAM_GB=192
    AGENT_HOST_DISK_GB=2000
    AGENT_REPO_DIR="$TMP_DIR"
    AGENT_CPU_LIMIT=1.0
    AGENT_MEMORY_LIMIT=1g
    AGENT_DISK_BUDGET_GB=5
)
if env "${OVERRIDE_ENV[@]}" bash "$HOST_INIT" --dry-run >"$TMP_DIR/override.out" 2>&1; then
    pass "global profile overrides are accepted"
else
    fail "global profile overrides are accepted"
fi
assert_contains "$TMP_DIR/override.out" "Required: CPU 7.00" "CPU override applies to every runtime"
assert_contains "$TMP_DIR/override.out" "RAM 7.00 GB" "memory override applies to every runtime"
assert_contains "$TMP_DIR/override.out" "disk 35.00 GB" "disk override applies to every runtime"

if [[ "$FAIL" -ne 0 ]]; then
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL" >&2
    exit 1
fi
printf '\n%d passed, 0 failed\n' "$PASS"
