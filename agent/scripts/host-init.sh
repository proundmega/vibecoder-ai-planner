#!/usr/bin/env bash
# fg-43 host sizing for the fg-54 supervisor.
#
# Reads the supervisor declaration (agent.ini), sums the CPU/RAM/disk profile
# for every declared runtime, compares it with the host after reservations, and
# writes .env.agent-host for the Compose stack. There is no PoolManager, pool
# admin token or MAX_POOL_SIZE in this model: the supervisor owns the children.
#
# Usage: agent/scripts/host-init.sh [--dry-run] [--explain] [--check] [--yes] [--force]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"

usage() {
    cat <<'EOF'
Usage: agent/scripts/host-init.sh [options]

Options:
  --dry-run   Detect, parse and print the calculation without writing.
  --explain   Print the formula and per-role breakdown.
  --check     Validate the declaration against this host; never writes/starts.
  --yes       Write the env file and start the supervisor Compose stack.
  --force     Overwrite an existing .env.agent-host.
  -h, --help  Show this help.

Environment:
  AGENT_INI_PATH             Declaration file (default: <repo>/agent.ini)
  AGENT_HOST_ENV_FILE        Output env file (default: <repo>/.env.agent-host)
  AGENT_HOST_CPU_THREADS     Test/override host threads (default: nproc)
  AGENT_HOST_RAM_GB          Test/override total RAM in GB
  AGENT_HOST_DISK_GB         Test/override free disk in GB
  AGENT_REPO_DIR             Path used for df (default: repo volume mountpoint)
  AGENT_UTILIZATION_TARGET   CPU utilization target (default: 0.80)
  AGENT_CPU_LIMIT            Override CPU per runtime; default is role profile
  AGENT_MEMORY_LIMIT         Override RAM per runtime (e.g. 4g); role profile
  AGENT_DISK_BUDGET_GB       Override workspace GB per runtime
  AGENT_RUNTIME_HEAP_MB      Child JVM heap (default: 768)
  AGENT_SUPERVISOR_OVERHEAD_MB  Supervisor/container overhead (default: 512)
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
        --explain) EXPLAIN=1 ;;
        --check) CHECK=1 ;;
        --yes) YES=1 ;;
        --force) FORCE=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown option '$1'" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

INI="${AGENT_INI_PATH:-$REPO_ROOT/agent.ini}"
ENV_FILE="${AGENT_HOST_ENV_FILE:-$REPO_ROOT/.env.agent-host}"
COMPOSE_FILE="$REPO_ROOT/agent/docker-compose.yml"
UTILIZATION="${AGENT_UTILIZATION_TARGET:-0.80}"
OVERHEAD_MB="${AGENT_SUPERVISOR_OVERHEAD_MB:-512}"
LOG_MAX_SIZE="${AGENT_LOG_MAX_SIZE:-10m}"
LOG_MAX_FILE="${AGENT_LOG_MAX_FILE:-3}"
HEAP_MB="${AGENT_RUNTIME_HEAP_MB:-768}"

fail() {
    echo "error: $*" >&2
    exit 1
}

require_positive_number() {
    local name="$1" value="$2"
    awk -v v="$value" 'BEGIN { exit !(v ~ /^[0-9]+([.][0-9]+)?$/ && v > 0) }' \
        || fail "$name must be a positive number (got '$value')"
}

require_positive_integer() {
    local name="$1" value="$2"
    [[ "$value" =~ ^[0-9]+$ && "$value" -gt 0 ]] \
        || fail "$name must be a positive integer (got '$value')"
}

memory_to_gb() {
    local value="$1" lower
    lower="$(printf '%s' "$value" | tr '[:upper:]' '[:lower:]')"
    case "$lower" in
        *g) printf '%s' "${lower%g}" ;;
        *m) awk -v m="${lower%m}" 'BEGIN { printf "%.4f", m / 1024 }' ;;
        *gb) printf '%s' "${lower%gb}" ;;
        *) printf '%s' "$lower" ;;
    esac
}

detect_threads() {
    if [[ -n "${AGENT_HOST_CPU_THREADS:-}" ]]; then
        printf '%s' "$AGENT_HOST_CPU_THREADS"
    elif command -v nproc >/dev/null 2>&1; then
        nproc
    elif command -v getconf >/dev/null 2>&1; then
        getconf _NPROCESSORS_ONLN
    else
        fail "cannot detect CPU threads; set AGENT_HOST_CPU_THREADS"
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
        fail "cannot detect RAM; set AGENT_HOST_RAM_GB"
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

[[ -f "$INI" ]] || fail "supervisor declaration not found: $INI
Copy agent/agent.ini.example to agent.ini and edit the runtime sections."

THREADS="$(detect_threads)"
RAM_GB="$(detect_ram_gb)"
DISK_GB="$(detect_disk_gb)"
require_positive_number "host threads" "$THREADS"
require_positive_number "host RAM GB" "$RAM_GB"
require_positive_number "host disk GB" "$DISK_GB"
require_positive_number "AGENT_UTILIZATION_TARGET" "$UTILIZATION"
require_positive_integer "AGENT_SUPERVISOR_OVERHEAD_MB" "$OVERHEAD_MB"
require_positive_integer "AGENT_RUNTIME_HEAP_MB" "$HEAP_MB"

declare -A COUNTS=([worker]=0 [reviewer]=0 [planner]=0)
CURRENT_SECTION=""
CURRENT_ROLE=""
CURRENT_COUNT=""

flush_section() {
    [[ -z "$CURRENT_SECTION" ]] && return 0
    [[ -n "$CURRENT_ROLE" ]] || fail "section '$CURRENT_SECTION' has no role"
    [[ -n "$CURRENT_COUNT" ]] || fail "section '$CURRENT_SECTION' has no count"
    [[ "$CURRENT_COUNT" =~ ^[0-9]+$ && "$CURRENT_COUNT" -gt 0 ]] \
        || fail "section '$CURRENT_SECTION' count must be a positive integer"
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
            worker|reviewer|planner) ;;
            *) fail "section '$CURRENT_SECTION' has unsupported role '$CURRENT_ROLE'" ;;
        esac
    elif [[ "$line" =~ ^count[[:space:]]*=[[:space:]]*(.+)$ ]]; then
        CURRENT_COUNT="${BASH_REMATCH[1]}"
    fi
done < "$INI"
flush_section

TOTAL=$(( COUNTS[worker] + COUNTS[reviewer] + COUNTS[planner] ))
[[ "$TOTAL" -gt 0 ]] || fail "no runtimes declared in $INI"

# Role profiles for a fg-54 runtime child (not a container per agent).
profile_cpu() {
    case "$1" in
        worker) printf '%s' "${AGENT_CPU_LIMIT:-2.0}" ;;
        *) printf '%s' "${AGENT_CPU_LIMIT:-1.0}" ;;
    esac
}
profile_ram_gb() {
    if [[ -n "${AGENT_MEMORY_LIMIT:-}" ]]; then
        memory_to_gb "$AGENT_MEMORY_LIMIT"
    else
        case "$1" in
            worker) printf '4' ;;
            *) printf '2' ;;
        esac
    fi
}
profile_disk_gb() {
    if [[ -n "${AGENT_DISK_BUDGET_GB:-}" ]]; then
        printf '%s' "$AGENT_DISK_BUDGET_GB"
    else
        case "$1" in
            worker) printf '20' ;;
            *) printf '10' ;;
        esac
    fi
}

REQ_CPU="0"
REQ_RAM_GB="0"
REQ_DISK_GB="0"
for role in worker reviewer planner; do
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

REQ_RAM_WITH_OVERHEAD="$(awk -v r="$REQ_RAM_GB" -v o="$OVERHEAD_MB" 'BEGIN { printf "%.2f", r + o / 1024 }')"
OVER=0
REASONS=()
if ! awk -v a="$REQ_CPU" -v b="$AVAILABLE_CPU" 'BEGIN { exit !(a <= b) }'; then
    OVER=1
    REASONS+=("CPU: need ${REQ_CPU}, available ${AVAILABLE_CPU} after reservation")
fi
if ! awk -v a="$REQ_RAM_WITH_OVERHEAD" -v b="$AVAILABLE_RAM" 'BEGIN { exit !(a <= b) }'; then
    OVER=1
    REASONS+=("RAM: need ${REQ_RAM_WITH_OVERHEAD} GB including supervisor overhead, available ${AVAILABLE_RAM} GB")
fi
if ! awk -v a="$REQ_DISK_GB" -v b="$AVAILABLE_DISK" 'BEGIN { exit !(a <= b) }'; then
    OVER=1
    REASONS+=("disk: need ${REQ_DISK_GB} GB, available ${AVAILABLE_DISK} GB at the 80% workspace target")
fi

echo "Host: ${THREADS} threads, ${RAM_GB} GB RAM, ${DISK_GB} GB free disk"
echo "Declared: ${TOTAL} runtime(s) (worker=${COUNTS[worker]}, reviewer=${COUNTS[reviewer]}, planner=${COUNTS[planner]})"
echo "Required: CPU ${REQ_CPU}, RAM ${REQ_RAM_GB} GB + ${OVERHEAD_MB} MB supervisor overhead, disk ${REQ_DISK_GB} GB"
echo "Available after reservation: CPU ${AVAILABLE_CPU}, RAM ${AVAILABLE_RAM} GB, disk ${AVAILABLE_DISK} GB"

if [[ "$EXPLAIN" -eq 1 ]]; then
    echo "Formula:"
    echo "  reserve_cpu  = max(2, threads * 0.15) = ${RESERVE_CPU}"
    echo "  reserve_ram  = max(8, ram_gb * 0.10)  = ${RESERVE_RAM} GB"
    echo "  reserve_disk = max(100, disk_gb * 0.10) = ${RESERVE_DISK} GB"
    echo "  available_cpu  = threads * ${UTILIZATION} - reserve_cpu = ${AVAILABLE_CPU}"
    echo "  available_ram  = ram_gb - reserve_ram = ${AVAILABLE_RAM} GB"
    echo "  available_disk = disk_gb * 0.80 - reserve_disk = ${AVAILABLE_DISK} GB"
    echo "  profiles: worker=2 CPU/4 GB/20 GB, reviewer=1/2/10, planner=1/2/10"
fi

if [[ "$OVER" -eq 1 ]]; then
    echo "Host capacity check failed:" >&2
    for reason in "${REASONS[@]}"; do
        echo "  - ${reason}" >&2
    done
    echo "No env file was written and no supervisor was started." >&2
    exit 1
fi

SUPERVISOR_MEMORY_LIMIT_GB="$(awk -v r="$REQ_RAM_GB" -v o="$OVERHEAD_MB" 'BEGIN { printf "%d", int(r + o / 1024 + 0.999) }')"
REQ_RAM_MB="$(awk -v r="$REQ_RAM_GB" 'BEGIN { printf "%d", int(r * 1024 + 0.5) }')"
echo "Supervisor container: ${SUPERVISOR_MEMORY_LIMIT_GB}G / ${REQ_CPU} cpus; AGENT_HOST_MAX_RUNTIMES=${TOTAL}"

if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "Dry run: no env file written."
    exit 0
fi
if [[ "$CHECK" -eq 1 ]]; then
    echo "Check passed: the declaration fits this host."
    exit 0
fi

if [[ -e "$ENV_FILE" && "$FORCE" -ne 1 ]]; then
    fail "$ENV_FILE already exists; re-run with --force to overwrite it"
fi

ENV_DIR="$(dirname -- "$ENV_FILE")"
mkdir -p "$ENV_DIR"
TMP_FILE="$(mktemp "$ENV_DIR/.env.agent-host.XXXXXX")"
trap 'rm -f "$TMP_FILE"' EXIT
umask 077
cat > "$TMP_FILE" <<EOF
# Generated by agent/scripts/host-init.sh — do not edit by hand.
# fg-54 supervisor capacity for the declaration in ${INI}
AGENT_HOST_MAX_RUNTIMES=${TOTAL}
AGENT_HOST_DECLARED_RUNTIMES=${TOTAL}
AGENT_HOST_REQUIRED_CPUS=${REQ_CPU}
AGENT_HOST_REQUIRED_MEMORY_GB=${REQ_RAM_GB}
AGENT_HOST_REQUIRED_DISK_GB=${REQ_DISK_GB}
SUPERVISOR_CPUS=${REQ_CPU}
SUPERVISOR_MEMORY_LIMIT=${SUPERVISOR_MEMORY_LIMIT_GB}G
SUPERVISOR_MEMORY_BUDGET_MB=${REQ_RAM_MB}
AGENT_RUNTIME_HEAP_MB=${HEAP_MB}
AGENT_LOG_MAX_SIZE=${LOG_MAX_SIZE}
AGENT_LOG_MAX_FILE=${LOG_MAX_FILE}
AGENT_INI_PATH=${INI}
EOF
chmod 600 "$TMP_FILE"
mv -f "$TMP_FILE" "$ENV_FILE"
trap - EXIT
chmod 600 "$ENV_FILE"

echo "Wrote ${ENV_FILE} (mode 0600)."
if [[ "$YES" -eq 1 ]]; then
    command -v docker >/dev/null 2>&1 || fail "docker is required for --yes"
    docker info >/dev/null 2>&1 || fail "Docker is not reachable; refusing to start"
    echo "Starting supervisor: docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d --build"
    ( cd "$REPO_ROOT" && docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" up -d --build )
else
    echo "Start with: docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} up -d --build"
fi
