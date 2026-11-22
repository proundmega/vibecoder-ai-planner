#!/usr/bin/env bash
# fg-44 stopped-supervisor storage recovery.
#
# Usage: agent/scripts/host-storage.sh [--dry-run|--apply] [--orphans] [--legacy]
#                                      [--images] [--json]
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
REPO_DIR="${AGENT_REPO_DIR:-/repos}"
TMP_ROOT="${AGENT_TMPDIR:-${TMPDIR:-/tmp}}"
PID_DIR="${SUPERVISOR_PID_DIR:-/tmp/vibecode-runtimes}"
RETENTION_HOURS="${HARNESS_WORKSPACE_RETENTION_HOURS:-24}"
ORPHAN_HOURS="${AGENT_ORPHAN_TTL_HOURS:-24}"
APPLY=0
JSON=0
DO_ORPHANS=0
DO_LEGACY=0
DO_IMAGES=0

usage() {
    cat <<'EOF'
Usage: agent/scripts/host-storage.sh [--dry-run|--apply] [--orphans] [--legacy] [--images] [--json]

Default is --dry-run. --apply requires the supervisor to be stopped and no
live .active marker. Exit codes: 0 ok, 2 args, 3 repo/Docker, 4 live state,
5 apply failed or critical free space remains.
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) APPLY=0 ;;
        --apply) APPLY=1 ;;
        --orphans) DO_ORPHANS=1 ;;
        --legacy) DO_LEGACY=1 ;;
        --images) DO_IMAGES=1 ;;
        --json) JSON=1 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "error: unknown option '$1'" >&2; usage >&2; exit 2 ;;
    esac
    shift
done

require_int() {
    [[ "$1" =~ ^[0-9]+$ ]] || { echo "error: $2 must be a non-negative integer" >&2; exit 2; }
}
require_int "$RETENTION_HOURS" HARNESS_WORKSPACE_RETENTION_HOURS
require_int "$ORPHAN_HOURS" AGENT_ORPHAN_TTL_HOURS

[[ -d "$REPO_DIR" ]] || { echo "error: repo path not found: $REPO_DIR" >&2; exit 3; }

live_state() {
    if [[ -d "$PID_DIR" ]]; then
        while IFS= read -r pidfile; do
            [[ -f "$pidfile" ]] || continue
            pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$pidfile" | head -1)"
            [[ -n "$pid" ]] || continue
            if kill -0 "$pid" 2>/dev/null; then
                echo "live supervisor PID $pid ($pidfile)"
                return 0
            fi
        done < <(find "$PID_DIR" -maxdepth 1 -type f -name '*.pid' -print 2>/dev/null)
    fi
    if [[ -d "$REPO_DIR/runtimes" ]] &&         [[ -n "$(find "$REPO_DIR/runtimes" -name '.active' -type f -newermt "-${RETENTION_HOURS} hours" -print -quit 2>/dev/null)" ]]; then
        echo "live .active marker under $REPO_DIR/runtimes"
        return 0
    fi
    return 1
}

if [[ "$APPLY" -eq 1 ]]; then
    if reason="$(live_state)"; then
        echo "refusing --apply: $reason; stop the supervisor and clear stale markers first" >&2
        exit 4
    fi
fi

cutoff_epoch=$(( $(date +%s) - RETENTION_HOURS * 3600 ))
removed=0
freed=0
actions=()

older_than() {
    local path="$1" epoch
    epoch="$(stat -c %Y "$path" 2>/dev/null || echo 0)"
    (( epoch > 0 && epoch < cutoff_epoch ))
}

sweep_runtime_roots() {
    [[ -d "$REPO_DIR/runtimes" ]] || return 0
    while IFS= read -r root; do
        [[ -d "$root" ]] || continue
        older_than "$root" || continue
        if [[ -n "$(find "$root" -name '.active' -type f -print -quit 2>/dev/null)" ]]; then
            actions+=("skip active $root")
            continue
        fi
        actions+=("remove runtime $root")
        if [[ "$APPLY" -eq 1 ]]; then
            size="$(du -sb "$root" 2>/dev/null | awk '{print $1}')"
            rm -rf -- "$root"
            removed=$((removed + 1))
            freed=$((freed + ${size:-0}))
        fi
    done < <(find "$REPO_DIR/runtimes" -mindepth 1 -maxdepth 1 -type d -print 2>/dev/null)
}

sweep_legacy() {
    while IFS= read -r dir; do
        [[ -d "$dir" ]] || continue
        older_than "$dir" || continue
        actions+=("remove legacy $dir")
        if [[ "$APPLY" -eq 1 ]]; then
            size="$(du -sb "$dir" 2>/dev/null | awk '{print $1}')"
            rm -rf -- "$dir"
            removed=$((removed + 1))
            freed=$((freed + ${size:-0}))
        fi
    done < <(find "$REPO_DIR" -mindepth 1 -maxdepth 1 -type d \
        -regextype posix-extended -regex '.*/[0-9a-f]{8}-.*' -print 2>/dev/null)

    while IFS= read -r dir; do
        [[ -d "$dir" ]] || continue
        older_than "$dir" || continue
        actions+=("remove temp $dir")
        if [[ "$APPLY" -eq 1 ]]; then
            size="$(du -sb "$dir" 2>/dev/null | awk '{print $1}')"
            rm -rf -- "$dir"
            removed=$((removed + 1))
            freed=$((freed + ${size:-0}))
        fi
    done < <(find "$TMP_ROOT" -mindepth 1 -maxdepth 1 -type d \
        \( -name 'opencode-harness-*' -o -name 'vibecode-askpass-*' \) -print 2>/dev/null)
}

if [[ "$DO_LEGACY" -eq 1 ]]; then
    sweep_legacy
else
    sweep_runtime_roots
    [[ "$DO_ORPHANS" -eq 1 ]] && sweep_legacy
fi

if [[ "$DO_IMAGES" -eq 1 ]]; then
    if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        if [[ "$APPLY" -eq 1 ]]; then
            docker image prune -f >/dev/null
            actions+=("pruned dangling images")
        else
            count="$(docker images -f dangling=true -q 2>/dev/null | wc -l | tr -d ' ')"
            actions+=("would prune $count dangling image(s)")
        fi
    else
        echo "error: Docker is not available for --images" >&2
        exit 3
    fi
fi

if [[ "$APPLY" -eq 1 ]]; then
    if [[ "$removed" -eq 0 ]]; then
        actions+=("nothing to remove")
    fi
fi

if [[ "$JSON" -eq 1 ]]; then
    printf '{"apply":%s,"removed":%s,"freedBytes":%s,"actions":[' "$APPLY" "$removed" "$freed"
    first=1
    for action in "${actions[@]+"${actions[@]}"}"; do
        [[ "$first" -eq 1 ]] || printf ','
        first=0
        printf '"%s"' "$(printf '%s' "$action" | sed 's/"/\\"/g')"
    done
    printf ']}\n'
else
    echo "repo=$REPO_DIR apply=$APPLY retentionHours=$RETENTION_HOURS removed=$removed freedBytes=$freed"
    for action in "${actions[@]+"${actions[@]}"}"; do
        echo "  $action"
    done
    if [[ "$APPLY" -eq 1 ]]; then
        df -Pk "$REPO_DIR" | awk 'NR == 2 { printf "freeBytes=%s freeInodes=%s\n", $4 * 1024, $5 }'
    fi
fi
