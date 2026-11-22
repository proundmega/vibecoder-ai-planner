#!/usr/bin/env bash
# fg-43 host sizing for the fg-54 supervisor.
#
# Reads the supervisor declaration (agent.ini), sums the agreed role profiles,
# compares the declaration with the host after reservations, and writes
# .env.agent-host for the Compose stack. There is no PoolManager, pool admin
# token, MAX_POOL_SIZE or admin API in this model.
#
# Usage: agent/scripts/host-init.sh [--dry-run] [--explain] [--check] [--yes] [--force]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

E_USAGE=2
E_HOST=3
E_INI=4
E_CAPACITY=5
E_START=6

usage() {
    cat <<'EOF'
Usage: agent/scripts/host-init.sh [options]

Options:
  --dry-run   Detect, parse and print the calculation without writing.
  --explain   Print the formula and per-role breakdown (implies --dry-run).
  --check     Validate the declaration against this host; never writes/starts.
  --yes       Write the env file and start the supervisor Compose stack.
  --force     Overwrite an existing .env.agent-host.
  -h, --help  Show this help.

Environment:
  AGENT_INI_PATH             Declaration file (default: ./agent.ini)
  AGENT_HOST_ENV_FILE        Output env file (default: ./.env.agent-host)
  AGENT_HOST_CPU_THREADS     Test/override host threads (default: nproc)
  AGENT_HOST_RAM_GB          Test/override total RAM in GB
  AGENT_HOST_DISK_GB         Test/override free disk in GB
  AGENT_REPO_DIR             Path used for df
  AGENT_UTILIZATION_TARGET   CPU utilization target (default: 0.80)
  AGENT_HOST_MAX_RUNTIMES    Hard cap (default: 50)
  AGENT_RUNTIME_HEAP_MB      Child JVM heap (default: 768)
  SANDBOX_MODE               host|docker (default: host)
  SANDBOX_CPUS               Sandbox CPU profile (default: 2.0)
  SANDBOX_MEMORY_MB          Sandbox RAM profile (default: 2048)
  SANDBOX_DISK_MB            Sandbox disk profile (default: 5120)
  SANDBOX_HOST_WORKSPACE_ROOT  Required in docker mode
  REPO_HOST_PATH             Repo bind path (validated in docker mode)
  BACKEND_URL                /health base (default: http://localhost:3001)
  API_PORT                   Local /health port fallback (default: 3001)
  COMPOSE_PROJECT_NAME       Compose project (default: vibecode-agent)
  AGENT_LOG_MAX_SIZE         Docker log rotation size (default: 10m)
  AGENT_LOG_MAX_FILE         Docker log rotation files (default: 3)
EOF
}

DRY_RUN=0
EXPLAIN=0
CHECK=0
YES=0
FORCE=0
while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=1 ;;
        --explain) EXPLAIN=1; DRY_RUN=1 ;;
        --check) CHECK=1 ;;
        --yes) YES=1 ;;
        --force) FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown option '$1'" >&2; usage >&2; exit "$E_USAGE" ;;
    esac
    shift
done

fail() {
    local code="$1"
    shift
    echo "error: $*" >&2
    exit "$code"
}

require_positive_number() {
    local name="$1" value="$2"
    awk -v v="$value" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v > 0) }' \
        || fail "$E_HOST" "$name must be a positive number (got '$value')"
}

require_non_negative_integer() {
    local name="$1" value="$2"
    [[ "$value" =~ ^[0-9]+$ ]] \
        || fail "$E_HOST" "$name must be a non-negative integer (got '$value')"
}

require_positive_integer() {
    local name="$1" value="$2"
    [[ "$value" =~ ^[0-9]+$ && "$value" -gt 0 ]] \
        || fail "$E_HOST" "$name must be a positive integer (got '$value')"
}

memory_to_gb() {
    local value="$1" lower
    lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
        *gb) printf '%s' "${lower%gb}" ;;
        *g) printf '%s' "${lower%g}" ;;
        *m) awk -v m="${lower%m}" 'BEGIN { printf "%.4f", m / 1024 }' ;;
        *) printf '%s' "$lower" ;;
    esac
}

canonical_file() {
    local path="$1"
    [[ -f "$path" ]] || fail "$E_INI" "file not found: $path"
    realpath "$path"
}

canonical_output() {
    local path="$1" dir base
    dir="$(dirname -- "$path")"
    base="$(basename -- "$path")"
    mkdir -p "$dir"
    printf '%s/%s' "$(cd -- "$dir" && pwd)" "$base"
}

detect_threads() {
    if [[ -n "${AGENT_HOST_CPU_THREADS:-}" ]]; then
        printf '%s' "$AGENT_HOST_CPU_THREADS"
    elif command -v nproc >/dev/null 2>&1; then
        nproc
    elif command -v getconf >/dev/null 2>&1; then
        getconf _NPROCESSORS_ONLN
    else
        fail "$E_HOST" "cannot detect CPU threads; set AGENT_HOST_CPU_THREADS"
    fi
}

detect_ram_gb() {
    if [[ -n "${AGENT_HOST_RAM_GB:-}" ]]; then
        printf '%s' "$AGENT_HOST_RAM_GB"
    elif [[ -r /proc/meminfo ]]; then
        awk '/^MemTotal:/ { printf "%.2f", $2 / 1024 / 1024 }' /proc/meminfo
    elif command -v sysctl >/dev/null 2>&1; then
        awk -v bytes="$(sysctl -n hw.memsize 2>/dev/null || echo 0)" \
            'BEGIN { printf "%.2f", bytes / 1024 / 1024 / 1024 }'
    else
        fail "$E_HOST" "cannot detect RAM; set AGENT_HOST_RAM_GB"
    fi
}

detect_disk_gb() {
    local path=""
    if [[ -n "${AGENT_HOST_DISK_GB:-}" ]]; then
        printf '%s' "$AGENT_HOST_DISK_GB"
        return
    fi
    if [[ -n "${AGENT_REPO_DIR:-}" ]]; then
        path="$AGENT_REPO_DIR"
    elif command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        path="$(docker volume inspect -f '{{.Mountpoint}}' \
            "${REPO_VOLUME:-vibecode_repos}" 2>/dev/null || true)"
    fi
    [[ -n "$path" && -d "$path" ]] || path="$REPO_ROOT"
    df -Pk "$path" | awk 'NR == 2 { printf "%.2f", $4 / 1024 / 1024 }'
}

INI="${AGENT_INI_PATH:-$REPO_ROOT/agent.ini}"
INI="$(canonical_file "$INI")"
ENV_FILE="${AGENT_HOST_ENV_FILE:-$REPO_ROOT/.env.agent-host}"
ENV_FILE="$(canonical_output "$ENV_FILE")"
COMPOSE_FILE="$REPO_ROOT/agent/docker-compose.yml"
SANDBOX_COMPOSE="$REPO_ROOT/agent/docker-compose.sandbox.yml"
UTILIZATION="${AGENT_UTILIZATION_TARGET:-0.80}"
HOST_MAX_RUNTIMES="${AGENT_HOST_MAX_RUNTIMES:-50}"
HEAP_MB="${AGENT_RUNTIME_HEAP_MB:-768}"
SANDBOX_MODE="${SANDBOX_MODE:-host}"
SANDBOX_CPUS="${SANDBOX_CPUS:-2.0}"
SANDBOX_MEMORY_MB="${SANDBOX_MEMORY_MB:-2048}"
SANDBOX_DISK_MB="${SANDBOX_DISK_MB:-5120}"
LOG_MAX_SIZE="${AGENT_LOG_MAX_SIZE:-10m}"
LOG_MAX_FILE="${AGENT_LOG_MAX_FILE:-3}"

THREADS="$(detect_threads)"
RAM_GB="$(detect_ram_gb)"
DISK_GB="$(detect_disk_gb)"
require_positive_number "host threads" "$THREADS"
require_positive_number "host RAM GB" "$RAM_GB"
require_positive_number "host disk GB" "$DISK_GB"
require_positive_number "AGENT_UTILIZATION_TARGET" "$UTILIZATION"
require_positive_integer "AGENT_RUNTIME_HEAP_MB" "$HEAP_MB"
require_non_negative_integer "AGENT_HOST_MAX_RUNTIMES" "$HOST_MAX_RUNTIMES"
require_positive_number "SANDBOX_CPUS" "$SANDBOX_CPUS"
require_positive_integer "SANDBOX_MEMORY_MB" "$SANDBOX_MEMORY_MB"
require_positive_integer "SANDBOX_DISK_MB" "$SANDBOX_DISK_MB"
case "$SANDBOX_MODE" in
    host|docker) ;;
    *) fail "$E_HOST" "SANDBOX_MODE must be host or docker (got '$SANDBOX_MODE')" ;;
esac

declare -A COUNTS=([worker]=0 [reviewer]=0 [planner]=0 [light]=0)
CURRENT_SECTION=""
CURRENT_ROLE=""
CURRENT_COUNT=""

flush_section() {
    [[ -z "$CURRENT_SECTION" ]] && return 0
    [[ -n "$CURRENT_ROLE" ]] || fail "$E_INI" "section '$CURRENT_SECTION' has no role"
    [[ -n "$CURRENT_COUNT" ]] || fail "$E_INI" "section '$CURRENT_SECTION' has no count"
    [[ "$CURRENT_COUNT" =~ ^[0-9]+$ && "$CURRENT_COUNT" -gt 0 && "$CURRENT_COUNT" -le 64 ]] \
        || fail "$E_INI" "section '$CURRENT_SECTION' count must be between 1 and 64"
    local count_value=$((10#$CURRENT_COUNT))
    COUNTS["$CURRENT_ROLE"]=$(( ${COUNTS[$CURRENT_ROLE]:-0} + count_value ))
}

while IFS= read -r raw || [[ -n "$raw" ]]; do
    raw="${raw%$'\r'}"
    line="$(printf '%s' "$raw" | sed -E 's/[[:space:]][;#].*$//; s/^[[:space:]]+//; s/[[:space:]]+$//')"
    [[ -z "$line" ]] && continue
    [[ "$line" == \;* || "$line" == "#"* ]] && continue

    if [[ "$line" == \[* ]]; then
        flush_section
        CURRENT_SECTION="$line"
        CURRENT_ROLE=""
        CURRENT_COUNT=""
        continue
    fi

    if [[ "$line" =~ ^role[[:space:]]*=[[:space:]]*(.+)$ ]]; then
        CURRENT_ROLE="${BASH_REMATCH[1]}"
        case "$CURRENT_ROLE" in
            worker|reviewer|planner|light) ;;
            *) fail "$E_INI" "section '$CURRENT_SECTION' has unsupported role '$CURRENT_ROLE'" ;;
        esac
    elif [[ "$line" =~ ^count[[:space:]]*=[[:space:]]*(.+)$ ]]; then
        CURRENT_COUNT="${BASH_REMATCH[1]}"
    fi
done < "$INI"
flush_section

TOTAL=$(( COUNTS[worker] + COUNTS[reviewer] + COUNTS[planner] + COUNTS[light] ))
[[ "$TOTAL" -gt 0 ]] || fail "$E_INI" "no runtimes declared in $INI"

# Agreed profiles. RAM includes the child JVM, its sandbox and JVM/OS overhead.
profile_cpu() {
    case "$1" in
        worker) printf '%s' "${AGENT_CPU_LIMIT:-2.0}" ;;
        reviewer|planner) printf '%s' "${AGENT_CPU_LIMIT:-1.5}" ;;
        light) printf '%s' "${AGENT_CPU_LIMIT:-0.5}" ;;
    esac
}
profile_ram_gb() {
    if [[ -n "${AGENT_MEMORY_LIMIT:-}" ]]; then
        memory_to_gb "$AGENT_MEMORY_LIMIT"
    else
        case "$1" in
            worker) printf '3' ;;
            reviewer|planner) printf '2.5' ;;
            light) printf '1.5' ;;
        esac
    fi
}
profile_disk_gb() {
    if [[ -n "${AGENT_DISK_BUDGET_GB:-}" ]]; then
        printf '%s' "$AGENT_DISK_BUDGET_GB"
    else
        case "$1" in
            worker) printf '20' ;;
            reviewer|planner) printf '10' ;;
            light) printf '5' ;;
        esac
    fi
}

REQ_CPU="0"
REQ_RAM_GB="0"
REQ_DISK_GB="0"
for role in worker reviewer planner light; do
    count="${COUNTS[$role]:-0}"
    [[ "$count" -eq 0 ]] && continue
    cpu="$(profile_cpu "$role")"
    ram="$(profile_ram_gb "$role")"
    disk="$(profile_disk_gb "$role")"
    require_positive_number "profile CPU for $role" "$cpu"
    require_positive_number "profile RAM for $role" "$ram"
    require_positive_number "profile disk for $role" "$disk"
    REQ_CPU="$(awk -v a="$REQ_CPU" -v b="$cpu" -v n="$count" 'BEGIN { printf "%.2f", a + b * n }')"
    REQ_RAM_GB="$(awk -v a="$REQ_RAM_GB" -v b="$ram" -v n="$count" 'BEGIN { printf "%.2f", a + b * n }')"
    REQ_DISK_GB="$(awk -v a="$REQ_DISK_GB" -v b="$disk" -v n="$count" 'BEGIN { printf "%.2f", a + b * n }')"
done

read -r RESERVE_CPU RESERVE_RAM RESERVE_DISK AVAILABLE_CPU AVAILABLE_RAM AVAILABLE_DISK < <(
    awk -v threads="$THREADS" -v ram="$RAM_GB" -v disk="$DISK_GB" \
        -v util="$UTILIZATION" \
        -v reserved_cpu="${AGENT_RESERVED_CPU:-}" \
        -v reserved_ram="${AGENT_RESERVED_MEMORY_GB:-}" \
        -v reserved_disk="${AGENT_RESERVED_DISK_GB:-}" '
        BEGIN {
            rc = reserved_cpu == "" ? (threads * 0.15 > 2 ? threads * 0.15 : 2) : reserved_cpu
            rr = reserved_ram == "" ? (ram * 0.10 > 8 ? ram * 0.10 : 8) : reserved_ram
            rd = reserved_disk == "" ? (disk * 0.10 > 100 ? disk * 0.10 : 100) : reserved_disk
            ac = threads * util - rc; if (ac < 0) ac = 0
            ar = ram - rr; if (ar < 0) ar = 0
            ad = disk * 0.80 - rd; if (ad < 0) ad = 0
            printf "%.2f %.2f %.2f %.2f %.2f %.2f\n", rc, rr, rd, ac, ar, ad
        }'
)

OVER=0
REASONS=()
if ! awk -v a="$REQ_CPU" -v b="$AVAILABLE_CPU" 'BEGIN { exit !(a <= b) }'; then
    OVER=1
    REASONS+=("cpu: need ${REQ_CPU}, available ${AVAILABLE_CPU} after reservation")
fi
if ! awk -v a="$REQ_RAM_GB" -v b="$AVAILABLE_RAM" 'BEGIN { exit !(a <= b) }'; then
    OVER=1
    REASONS+=("ram: need ${REQ_RAM_GB} GB, available ${AVAILABLE_RAM} GB")
fi
if ! awk -v a="$REQ_DISK_GB" -v b="$AVAILABLE_DISK" 'BEGIN { exit !(a <= b) }'; then
    OVER=1
    REASONS+=("disk: need ${REQ_DISK_GB} GB, available ${AVAILABLE_DISK} GB at the 80% target")
fi
if [[ "$HOST_MAX_RUNTIMES" -gt 0 && "$TOTAL" -gt "$HOST_MAX_RUNTIMES" ]]; then
    OVER=1
    REASONS+=("runtime count: declared ${TOTAL}, AGENT_HOST_MAX_RUNTIMES=${HOST_MAX_RUNTIMES}")
fi

BINDING="$(awk -v cm="$(awk -v a="$AVAILABLE_CPU" -v b="$REQ_CPU" 'BEGIN { print a - b }')" \
    -v rm="$(awk -v a="$AVAILABLE_RAM" -v b="$REQ_RAM_GB" 'BEGIN { print a - b }')" \
    -v dm="$(awk -v a="$AVAILABLE_DISK" -v b="$REQ_DISK_GB" 'BEGIN { print a - b }')" '
    BEGIN {
        binding = "cpu"; margin = cm
        if (rm < margin) { binding = "ram"; margin = rm }
        if (dm < margin) { binding = "disk"; margin = dm }
        print binding
    }')"

echo "Host: ${THREADS} threads, ${RAM_GB} GB RAM, ${DISK_GB} GB free disk"
echo "Declared: ${TOTAL} runtime(s) (worker=${COUNTS[worker]}, reviewer=${COUNTS[reviewer]}, planner=${COUNTS[planner]}, light=${COUNTS[light]})"
echo "Required: CPU ${REQ_CPU}, RAM ${REQ_RAM_GB} GB, disk ${REQ_DISK_GB} GB"
echo "Available after reservation: CPU ${AVAILABLE_CPU}, RAM ${AVAILABLE_RAM} GB, disk ${AVAILABLE_DISK} GB"

if [[ "$EXPLAIN" -eq 1 ]]; then
    echo "Formula:"
    echo "  reserve_cpu  = max(2, threads * 0.15) = ${RESERVE_CPU}"
    echo "  reserve_ram  = max(8, ram_gb * 0.10)  = ${RESERVE_RAM} GB"
    echo "  reserve_disk = max(100, disk_gb * 0.10) = ${RESERVE_DISK} GB"
    echo "  available_cpu  = threads * ${UTILIZATION} - reserve_cpu = ${AVAILABLE_CPU}"
    echo "  available_ram  = ram_gb - reserve_ram = ${AVAILABLE_RAM} GB"
    echo "  available_disk = disk_gb * 0.80 - reserve_disk = ${AVAILABLE_DISK} GB"
    echo "  profiles: worker=2 CPU/3 GB/20 GB, reviewer=1.5/2.5/10, planner=1.5/2.5/10, light=0.5/1.5/5"
fi

if [[ "$OVER" -eq 1 ]]; then
    echo "Host capacity check failed (binding: ${BINDING}):" >&2
    for reason in "${REASONS[@]}"; do
        echo "  - ${reason}" >&2
    done
    echo "No env file was written and no supervisor was started." >&2
    exit "$E_CAPACITY"
fi

SUPERVISOR_CPUS="$(awk -v a="$AVAILABLE_CPU" -v n="$TOTAL" 'BEGIN {
    c = n < 2 ? 2 : n
    printf "%.2f", c < a ? c : a
}')"
SUPERVISOR_MEMORY_BUDGET_MB=$(( TOTAL * HEAP_MB ))
SUPERVISOR_MEMORY_LIMIT_GB="$(awk -v b="$SUPERVISOR_MEMORY_BUDGET_MB" 'BEGIN {
    printf "%d", int((b / 1024) + 0.999) + 1
}')"
echo "Supervisor container: ${SUPERVISOR_MEMORY_LIMIT_GB}G / ${SUPERVISOR_CPUS} cpus (budget ${SUPERVISOR_MEMORY_BUDGET_MB} MB); AGENT_HOST_MAX_RUNTIMES=${HOST_MAX_RUNTIMES}"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Dry run: no env file written."
    exit 0
fi
if [[ "$CHECK" -eq 1 ]]; then
    echo "Check passed: the declaration fits this host (binding: ${BINDING})."
    exit 0
fi

# Docker-mode prerequisites are validated before writing an env file.
COMPOSE_FILES=(-f "$COMPOSE_FILE")
if [[ "$SANDBOX_MODE" == "docker" ]]; then
    [[ -f "$SANDBOX_COMPOSE" ]] \
        || fail "$E_HOST" "sandbox overlay not found: $SANDBOX_COMPOSE"
    [[ -n "${SANDBOX_HOST_WORKSPACE_ROOT:-}" ]] \
        || fail "$E_HOST" "SANDBOX_MODE=docker requires SANDBOX_HOST_WORKSPACE_ROOT"
    [[ -d "${SANDBOX_HOST_WORKSPACE_ROOT}" ]] \
        || fail "$E_HOST" "SANDBOX_HOST_WORKSPACE_ROOT is not a directory: $SANDBOX_HOST_WORKSPACE_ROOT"
    if [[ -n "${REPO_HOST_PATH:-}" && ! -d "$REPO_HOST_PATH" ]]; then
        fail "$E_HOST" "REPO_HOST_PATH is not a directory: $REPO_HOST_PATH"
    fi
    COMPOSE_FILES+=(-f "$SANDBOX_COMPOSE")
fi

if [[ "$YES" -eq 1 ]]; then
    command -v docker >/dev/null 2>&1 || fail "$E_HOST" "docker is required for --yes"
    docker info >/dev/null 2>&1 || fail "$E_HOST" "Docker is not reachable; refusing to start"
fi

if [[ -e "$ENV_FILE" && "$FORCE" -ne 1 ]]; then
    fail "$E_HOST" "$ENV_FILE already exists; re-run with --force to overwrite it"
fi

TMP_FILE="$(mktemp "$(dirname -- "$ENV_FILE")/.env.agent-host.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT
umask 077
cat > "$TMP_FILE" <<EOF
# Generated by agent/scripts/host-init.sh — do not edit by hand.
# fg-54 supervisor capacity for the declaration in ${INI}
AGENT_RUNTIME_HEAP_MB=${HEAP_MB}
SUPERVISOR_MEMORY_BUDGET_MB=${SUPERVISOR_MEMORY_BUDGET_MB}
SUPERVISOR_MEMORY_LIMIT=${SUPERVISOR_MEMORY_LIMIT_GB}G
SUPERVISOR_CPUS=${SUPERVISOR_CPUS}
SANDBOX_CPUS=${SANDBOX_CPUS}
SANDBOX_MEMORY_MB=${SANDBOX_MEMORY_MB}
SANDBOX_DISK_MB=${SANDBOX_DISK_MB}
AGENT_HOST_MAX_RUNTIMES=${HOST_MAX_RUNTIMES}
AGENT_HOST_DECLARED_RUNTIMES=${TOTAL}
AGENT_HOST_BINDING_LIMIT=${BINDING}
AGENT_HOST_REQUIRED_CPUS=${REQ_CPU}
AGENT_HOST_REQUIRED_MEMORY_GB=${REQ_RAM_GB}
AGENT_HOST_REQUIRED_DISK_GB=${REQ_DISK_GB}
AGENT_LOG_MAX_SIZE=${LOG_MAX_SIZE}
AGENT_LOG_MAX_FILE=${LOG_MAX_FILE}
AGENT_INI_PATH=${INI}
EOF
chmod 600 "$TMP_FILE"
mv -f "$TMP_FILE" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"

wait_for_health() {
    local timeout="${HOST_INIT_HEALTH_TIMEOUT_SECONDS:-120}"
    local interval="${HOST_INIT_HEALTH_INTERVAL_SECONDS:-2}"
    [[ "$timeout" =~ ^[0-9]+$ ]] || timeout=120
    [[ "$interval" =~ ^[0-9]+$ && "$interval" -gt 0 ]] || interval=2
    if [[ "$timeout" -eq 0 ]]; then
        echo "Health wait disabled (HOST_INIT_HEALTH_TIMEOUT_SECONDS=0)."
        return 0
    fi
    if [[ -n "${BACKEND_URL:-}" ]]; then
        local base="${BACKEND_URL%/}"
        local url="${base}/health"
    else
        local url="http://localhost:${API_PORT:-3001}/health"
    fi
    local deadline=$((SECONDS + timeout))
    while (( SECONDS < deadline )); do
        if command -v curl >/dev/null 2>&1; then
            curl -fsS --max-time 2 "$url" >/dev/null 2>&1 && { echo "Backend healthy: $url"; return 0; }
        elif command -v wget >/dev/null 2>&1; then
            wget -q -O /dev/null --timeout=2 "$url" 2>/dev/null && { echo "Backend healthy: $url"; return 0; }
        else
            fail "$E_HOST" "curl or wget is required for the --yes health check"
        fi
        sleep "$interval"
    done
    fail "$E_START" "backend health timeout after ${timeout}s: $url (the stack was left up)"
}

echo "Wrote ${ENV_FILE} (mode 0600)."
COMPOSE_ARGS=(docker compose --env-file "$ENV_FILE" "${COMPOSE_FILES[@]}" up -d --build)
if [[ "$YES" -eq 1 ]]; then
    echo "Starting supervisor: ${COMPOSE_ARGS[*]}"
    COMPOSE_ENV=(AGENT_INI_PATH="$INI")
    if [[ -n "${REPO_HOST_PATH:-}" ]]; then
        COMPOSE_ENV+=("REPO_HOST_PATH=$(cd -- "$REPO_HOST_PATH" && pwd)")
    fi
    ( cd "$REPO_ROOT" && env "${COMPOSE_ENV[@]}" "${COMPOSE_ARGS[@]}" ) \
        || fail "$E_START" "docker compose failed to start the supervisor"
    wait_for_health
else
    echo "Start with: AGENT_INI_PATH=${INI} ${COMPOSE_ARGS[*]}"
fi
