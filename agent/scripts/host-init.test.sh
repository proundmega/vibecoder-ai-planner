#!/usr/bin/env bash
# Hermetic tests for agent/scripts/host-init.sh (fg-43).
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
HOST_INIT="$SCRIPT_DIR/host-init.sh"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

PASS=0
FAIL=0
pass() { PASS=$((PASS + 1)); printf 'ok - %s\n' "$1"; }
fail() { FAIL=$((FAIL + 1)); printf 'not ok - %s\n' "$1" >&2; }
assert_contains() {
    local file="$1" needle="$2" label="$3"
    if [[ ! -e "$file" ]]; then fail "$label (missing file: $file)"; return; fi
    if grep -Fq -- "$needle" "$file"; then pass "$label"; else fail "$label (missing: $needle)"; fi
}
assert_not_contains() {
    local file="$1" needle="$2" label="$3"
    if [[ ! -e "$file" ]]; then pass "$label"; return; fi
    if grep -Fq -- "$needle" "$file"; then fail "$label (found: $needle)"; else pass "$label"; fi
}
expect_exit() {
    local expected="$1" label="$2"; shift 2
    local actual=0
    "$@" >/dev/null 2>&1 || actual=$?
    if [[ "$actual" -eq "$expected" ]]; then pass "$label"; else fail "$label (expected $expected, got $actual)"; fi
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

# 48 threads / 192 GB / 2 TB reference host:
# 3 workers + 2 reviewers + 2 planners = 12 CPU / 19 GB / 100 GB.
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
assert_contains "$DRY_OUT" "Required: CPU 12.00" "required CPU sums role profiles"
assert_contains "$DRY_OUT" "RAM 19.00 GB" "required RAM sums role profiles"
assert_contains "$DRY_OUT" "disk 100.00 GB" "required disk sums role profiles"
assert_contains "$DRY_OUT" "Supervisor container: 7G / 7.00 cpus (budget 5376 MB)" "container limit uses heap budget"
assert_contains "$DRY_OUT" "Formula:" "explain prints the formula"
assert_not_contains "$TMP_DIR/.env.agent-host" "AGENT_HOST_MAX_RUNTIMES" "dry-run does not write the env file"

rm -rf "$TMP_DIR/unwritten"
if env "${REFERENCE_ENV[@]}" AGENT_HOST_ENV_FILE="$TMP_DIR/unwritten/env" bash "$HOST_INIT" --dry-run >/dev/null 2>&1; then
    pass "dry-run succeeds with a missing output directory"
else
    fail "dry-run succeeds with a missing output directory"
fi
if [[ -d "$TMP_DIR/unwritten" ]]; then fail "dry-run creates no output directory"; else pass "dry-run creates no output directory"; fi

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" --check >"$TMP_DIR/check.out" 2>&1; then
    pass "reference host check passes"
else
    fail "reference host check passes"
fi
assert_contains "$TMP_DIR/check.out" "Check passed" "check reports success"
assert_contains "$TMP_DIR/check.out" "binding: cpu" "check reports the binding limit"
assert_contains "$TMP_DIR/check.out" "SUPERVISOR_CPUS=7.00" "check prints the manual CPU value"
assert_contains "$TMP_DIR/check.out" "SUPERVISOR_MEMORY_LIMIT=7G" "check prints the manual memory value"
assert_contains "$TMP_DIR/check.out" "AGENT_HOST_MAX_RUNTIMES=50" "check prints the cap"

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" >"$TMP_DIR/write.out" 2>&1; then
    pass "env file write succeeds"
else
    fail "env file write succeeds"
fi
ENV_FILE="$TMP_DIR/.env.agent-host"
assert_contains "$ENV_FILE" "AGENT_RUNTIME_HEAP_MB=768" "writes the child heap"
assert_contains "$ENV_FILE" "SUPERVISOR_MEMORY_BUDGET_MB=5376" "budget is declared x heap"
assert_contains "$ENV_FILE" "SUPERVISOR_MEMORY_LIMIT=7G" "container memory covers the heap budget"
assert_contains "$ENV_FILE" "SUPERVISOR_CPUS=7.00" "container cpus is the orchestration limit"
assert_contains "$ENV_FILE" "SUPERVISOR_HEALTH_REQUIRED=true" "health gate defaults on"
assert_contains "$ENV_FILE" "SUPERVISOR_HEALTH_TIMEOUT_SECONDS=120" "health gate timeout is written"
assert_contains "$ENV_FILE" "SUPERVISOR_HEALTH_INTERVAL_SECONDS=2" "health gate interval is written"
assert_contains "$ENV_FILE" "SUPERVISOR_HEALTH_MONITOR_ENABLED=true" "health monitor defaults on"
assert_contains "$ENV_FILE" "SUPERVISOR_HEALTH_MONITOR_INTERVAL_SECONDS=10" "health monitor interval is written"
assert_contains "$ENV_FILE" "SUPERVISOR_HEALTH_MONITOR_MAX_BACKOFF_SECONDS=60" "health monitor backoff is written"
assert_contains "$ENV_FILE" "SANDBOX_CPUS=2.0" "writes sandbox CPU"
assert_contains "$ENV_FILE" "SANDBOX_MEMORY_MB=2048" "writes sandbox RAM"
assert_contains "$ENV_FILE" "SANDBOX_DISK_MB=5120" "writes sandbox disk"
assert_contains "$ENV_FILE" "AGENT_HOST_MAX_RUNTIMES=50" "default max is 50"
assert_contains "$ENV_FILE" "AGENT_HOST_DECLARED_RUNTIMES=7" "writes the declared count"
assert_contains "$ENV_FILE" "AGENT_HOST_BINDING_LIMIT=cpu" "writes the binding limit"
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

if env "${REFERENCE_ENV[@]}" bash "$HOST_INIT" --bogus >"$TMP_DIR/args.out" 2>&1; then
    fail "unknown option exits non-zero"
else
    actual=$?
    [[ "$actual" -eq 2 ]] && pass "unknown option exits 2" || fail "unknown option exits 2 (got $actual)"
fi

if env AGENT_INI_PATH="$TMP_DIR/missing.ini" bash "$HOST_INIT" --dry-run >"$TMP_DIR/missing.out" 2>&1; then
    fail "missing declaration exits non-zero"
else
    actual=$?
    [[ "$actual" -eq 4 ]] && pass "missing declaration exits 4" || fail "missing declaration exits 4 (got $actual)"
fi

# CPU-only over capacity.
OVER_ENV=(
    AGENT_INI_PATH="$TMP_DIR/agent.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/over.env"
    AGENT_HOST_CPU_THREADS=4
    AGENT_HOST_RAM_GB=192
    AGENT_HOST_DISK_GB=2000
    AGENT_REPO_DIR="$TMP_DIR"
)
if env "${OVER_ENV[@]}" bash "$HOST_INIT" --dry-run >"$TMP_DIR/over.out" 2>&1; then
    fail "CPU over-capacity fails closed"
else
    actual=$?
    [[ "$actual" -eq 5 ]] && pass "CPU over-capacity exits 5" || fail "CPU over-capacity exits 5 (got $actual)"
fi
assert_contains "$TMP_DIR/over.out" "binding: cpu" "CPU failure reports the binding limit"
assert_contains "$TMP_DIR/over.out" "cpu: need" "CPU failure names the constraint"
if [[ -e "$TMP_DIR/over.env" ]]; then fail "over-capacity writes no env file"; else pass "over-capacity writes no env file"; fi

# RAM-only over capacity.
RAM_ENV=(
    AGENT_INI_PATH="$TMP_DIR/agent.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/ram.env"
    AGENT_HOST_CPU_THREADS=48
    AGENT_HOST_RAM_GB=16
    AGENT_HOST_DISK_GB=2000
    AGENT_REPO_DIR="$TMP_DIR"
)
if env "${RAM_ENV[@]}" bash "$HOST_INIT" --dry-run >"$TMP_DIR/ram.out" 2>&1; then
    fail "RAM over-capacity fails closed"
else
    actual=$?
    [[ "$actual" -eq 5 ]] && pass "RAM over-capacity exits 5" || fail "RAM over-capacity exits 5 (got $actual)"
fi
assert_contains "$TMP_DIR/ram.out" "binding: ram" "RAM failure reports the binding limit"
assert_contains "$TMP_DIR/ram.out" "ram: need" "RAM failure names the constraint"

# Disk-only over capacity.
DISK_ENV=(
    AGENT_INI_PATH="$TMP_DIR/agent.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/disk.env"
    AGENT_HOST_CPU_THREADS=48
    AGENT_HOST_RAM_GB=192
    AGENT_HOST_DISK_GB=200
    AGENT_REPO_DIR="$TMP_DIR"
)
if env "${DISK_ENV[@]}" bash "$HOST_INIT" --dry-run >"$TMP_DIR/disk.out" 2>&1; then
    fail "disk over-capacity fails closed"
else
    actual=$?
    [[ "$actual" -eq 5 ]] && pass "disk over-capacity exits 5" || fail "disk over-capacity exits 5 (got $actual)"
fi
assert_contains "$TMP_DIR/disk.out" "binding: disk" "disk failure reports the binding limit"
assert_contains "$TMP_DIR/disk.out" "disk: need" "disk failure names the constraint"

# Light pollers are a first-class sizing role.
cat > "$TMP_DIR/light.ini" <<'INI'
[runtime "light-poller"]
role = light
model = acme/model
count = 4
project = 1
INI
LIGHT_ENV=(
    AGENT_INI_PATH="$TMP_DIR/light.ini"
    AGENT_HOST_ENV_FILE="$TMP_DIR/light.env"
    AGENT_HOST_CPU_THREADS=8
    AGENT_HOST_RAM_GB=32
    AGENT_HOST_DISK_GB=500
    AGENT_REPO_DIR="$TMP_DIR"
)
if env "${LIGHT_ENV[@]}" bash "$HOST_INIT" --dry-run >"$TMP_DIR/light.out" 2>&1; then
    pass "light role is accepted"
else
    fail "light role is accepted"
fi
assert_contains "$TMP_DIR/light.out" "light=4" "light count is reported"
assert_contains "$TMP_DIR/light.out" "Required: CPU 2.00" "light CPU profile is applied"
assert_contains "$TMP_DIR/light.out" "RAM 6.00 GB" "light RAM profile is applied"
assert_contains "$TMP_DIR/light.out" "disk 20.00 GB" "light disk profile is applied"

# Heap override drives the budget and memory limit.
HEAP_ENV=("${REFERENCE_ENV[@]}" AGENT_RUNTIME_HEAP_MB=4096 AGENT_HOST_ENV_FILE="$TMP_DIR/heap.env")
if env "${HEAP_ENV[@]}" bash "$HOST_INIT" >"$TMP_DIR/heap.out" 2>&1; then
    pass "heap override is accepted"
else
    fail "heap override is accepted"
fi
assert_contains "$TMP_DIR/heap.env" "AGENT_RUNTIME_HEAP_MB=4096" "writes the overridden heap"
assert_contains "$TMP_DIR/heap.env" "SUPERVISOR_MEMORY_BUDGET_MB=28672" "budget follows the heap override"
assert_contains "$TMP_DIR/heap.env" "SUPERVISOR_MEMORY_LIMIT=29G" "limit follows the heap override"

# Relative input paths are canonicalized for Compose.
REL_ENV=("${REFERENCE_ENV[@]}" AGENT_INI_PATH="agent/agent.ini.example" AGENT_HOST_ENV_FILE="$TMP_DIR/rel.env")
if ( cd "$REPO_ROOT" && env "${REL_ENV[@]}" bash "$HOST_INIT" >"$TMP_DIR/rel.out" 2>&1 ); then
    pass "relative input path succeeds"
else
    fail "relative input path succeeds"
fi
assert_contains "$TMP_DIR/rel.env" "AGENT_INI_PATH=$REPO_ROOT/agent/agent.ini.example" "canonicalizes the ini path"

# Global profile overrides.
OVERRIDE_ENV=(
    "${REFERENCE_ENV[@]}"
    AGENT_HOST_ENV_FILE="$TMP_DIR/override.env"
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

# Docker sandbox mode adds the overlay and passes the canonical ini path.
mkdir -p "$TMP_DIR/bin" "$TMP_DIR/repo-bind"
cat > "$TMP_DIR/bin/docker" <<'EOS'
#!/usr/bin/env bash
if [[ "${1:-}" == "info" ]]; then exit 0; fi
{
    printf '%s\n' "$*"
    env | grep '^AGENT_INI_PATH=' || true
} >> "${FAKE_DOCKER_LOG:?}"
exit 0
EOS
cat > "$TMP_DIR/bin/curl" <<'EOS'
#!/usr/bin/env bash
printf '%s\n' "$*" >> "${FAKE_CURL_LOG:-/dev/null}"
exit 0
EOS
chmod +x "$TMP_DIR/bin/docker" "$TMP_DIR/bin/curl"
SANDBOX_ENV=(
    "${REFERENCE_ENV[@]}"
    AGENT_HOST_ENV_FILE="$TMP_DIR/sandbox.env"
    SANDBOX_MODE=docker
    SANDBOX_HOST_WORKSPACE_ROOT="$TMP_DIR"
    REPO_HOST_PATH="$TMP_DIR/repo-bind"
    BACKEND_URL=http://backend.test
    COMPOSE_PROJECT_NAME=fg43-test
    FAKE_DOCKER_LOG="$TMP_DIR/docker.log"
    FAKE_CURL_LOG="$TMP_DIR/curl.log"
    PATH="$TMP_DIR/bin:$PATH"
)
if env "${SANDBOX_ENV[@]}" bash "$HOST_INIT" --yes >"$TMP_DIR/sandbox.out" 2>&1; then
    pass "docker sandbox mode starts with the overlay"
else
    fail "docker sandbox mode starts with the overlay"
fi
assert_contains "$TMP_DIR/docker.log" "compose -p fg43-test" "compose receives the project name"
assert_contains "$TMP_DIR/docker.log" "--env-file" "compose receives the env file"
assert_contains "$TMP_DIR/docker.log" "agent/docker-compose.sandbox.yml" "sandbox overlay is included"
assert_contains "$TMP_DIR/docker.log" "AGENT_INI_PATH=$TMP_DIR/agent.ini" "compose receives the canonical ini path"
assert_contains "$TMP_DIR/sandbox.out" "Backend healthy" "health wait succeeds"
assert_contains "$TMP_DIR/curl.log" "/api/health" "health wait uses /api/health"

# Docker mode without the host workspace root fails before writing.
SANDBOX_MISSING=(
    "${REFERENCE_ENV[@]}"
    AGENT_HOST_ENV_FILE="$TMP_DIR/sandbox-missing.env"
    SANDBOX_MODE=docker
    FAKE_DOCKER_LOG="$TMP_DIR/docker-missing.log"
    PATH="$TMP_DIR/bin:$PATH"
)
if env "${SANDBOX_MISSING[@]}" bash "$HOST_INIT" --yes >"$TMP_DIR/sandbox-missing.out" 2>&1; then
    fail "docker mode without workspace root fails"
else
    actual=$?
    [[ "$actual" -eq 3 ]] && pass "docker mode without workspace root exits 3" || fail "docker mode without workspace root exits 3 (got $actual)"
fi
if [[ -e "$TMP_DIR/sandbox-missing.env" ]]; then fail "sandbox validation writes no env file"; else pass "sandbox validation writes no env file"; fi

if [[ "$FAIL" -ne 0 ]]; then
    printf '\n%d passed, %d failed\n' "$PASS" "$FAIL" >&2
    exit 1
fi
printf '\n%d passed, 0 failed\n' "$PASS"
