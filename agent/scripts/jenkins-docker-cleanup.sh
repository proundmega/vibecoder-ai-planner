#!/usr/bin/env bash
#
# Scoped cleanup for Jenkins Docker resources.
#
# This is the executable half of bp-135. It is intentionally conservative:
# every automatic mode selects resources by positive labels and a strict
# project-name pattern, refuses the local-dev project and shared data volumes,
# and never runs a broad prune.
#
# Usage:
#   jenkins-docker-cleanup.sh --compose-project NAME --build-id ID
#   jenkins-docker-cleanup.sh --build-images ID
#   jenkins-docker-cleanup.sh --orphans
#   jenkins-docker-cleanup.sh --legacy-inventory
#
# Environment:
#   CI_DOCKER_HOST            explicit daemon (or --docker-host)
#   CI_DOCKER_DAEMON_ID       expected docker info ID (or --daemon-id)
#   CI_IMAGE_GRACE_HOURS      default 24
#   CI_CONTAINER_GRACE_HOURS  default 2
#   CI_BUILD_GRACE_HOURS      default 6
#   DRY_RUN                   true/1 for no mutation
#
# Compose/post modes are best-effort and exit 0; --orphans exits non-zero on
# a real failure. --legacy-inventory is read-only.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -n "${CI_REPO_ROOT:-}" ]; then
    ROOT="$CI_REPO_ROOT"
else
    ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel 2>/dev/null \
        || (cd "$SCRIPT_DIR/../.." && pwd))"
fi

MODE=""
PROJECT=""
BUILD_ID=""
DRY_RUN="${DRY_RUN:-false}"
DOCKER_HOST="${CI_DOCKER_HOST:-${DOCKER_HOST:-}}"
DAEMON_ID="${CI_DOCKER_DAEMON_ID:-}"
IMAGE_GRACE="${CI_IMAGE_GRACE_HOURS:-24}"
CONTAINER_GRACE="${CI_CONTAINER_GRACE_HOURS:-2}"
BUILD_GRACE="${CI_BUILD_GRACE_HOURS:-6}"
CURRENT_BUILD="${CI_CURRENT_BUILD_ID:-}"
LOCAL_PROJECT="vibecoder-ai-planner"
SHARED_VOLUMES="postgres_data uploads_data vibecode_repos"

usage() {
    sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
}

die() {
    echo "error: $*" >&2
    exit 2
}

log() {
    echo "[cleanup] $*"
}

is_true() {
    [ "$1" = "true" ] || [ "$1" = "1" ]
}

while [ $# -gt 0 ]; do
    case "$1" in
        --compose-project)
            [ $# -ge 2 ] || die "--compose-project requires a value"
            MODE="compose"
            PROJECT="$2"
            shift 2
            ;;
        --build-images)
            [ $# -ge 2 ] || die "--build-images requires a build id"
            MODE="build-images"
            BUILD_ID="$2"
            shift 2
            ;;
        --build-id)
            [ $# -ge 2 ] || die "--build-id requires a value"
            BUILD_ID="$2"
            shift 2
            ;;
        --orphans)
            MODE="orphans"
            shift
            ;;
        --legacy-inventory)
            MODE="legacy-inventory"
            shift
            ;;
        --dry-run)
            DRY_RUN="true"
            shift
            ;;
        --docker-host)
            [ $# -ge 2 ] || die "--docker-host requires a value"
            DOCKER_HOST="$2"
            shift 2
            ;;
        --daemon-id)
            [ $# -ge 2 ] || die "--daemon-id requires a value"
            DAEMON_ID="$2"
            shift 2
            ;;
        --help|-h)
            usage
            exit 0
            ;;
        *)
            die "unknown argument: $1"
            ;;
    esac
done

[ -n "$MODE" ] || die "one mode is required (--compose-project, --build-images, --orphans or --legacy-inventory)"
[ -n "$DOCKER_HOST" ] || die "DOCKER_HOST/CI_DOCKER_HOST is required in explicit mode"

export SANDBOX_CI_DOCKER_HOST_MODE=explicit
export DOCKER_HOST
# shellcheck source=sandbox-ci-env.sh
. "$SCRIPT_DIR/sandbox-ci-env.sh"

if [ -n "$DAEMON_ID" ]; then
    actual="$(docker info --format '{{.ID}}' 2>/dev/null || true)"
    [ -n "$actual" ] || die "cannot read the Docker daemon ID from $DOCKER_HOST"
    [ "$actual" = "$DAEMON_ID" ] || die "daemon mismatch: expected $DAEMON_ID, got $actual"
fi

valid_project() {
    case "$1" in
        "$LOCAL_PROJECT")
            return 1
            ;;
    esac
    [[ "$1" =~ ^vibecode-[a-z0-9][a-z0-9-]*-[0-9]+$ ]]
}

project_anchor() {
    local project="$1"
    docker network ls \
        --filter "label=com.docker.compose.project=$project" \
        --filter "label=com.vibecode.ci=true" \
        --format '{{.ID}}' 2>/dev/null | grep -q . \
        || docker volume ls \
            --filter "label=com.docker.compose.project=$project" \
            --filter "label=com.vibecode.ci=true" \
            --format '{{.Name}}' 2>/dev/null | grep -q .
}

compose_files() {
    printf '%s\n' \
        -f "$ROOT/docker-compose.yml" \
        -f "$ROOT/docker-compose.test.yml" \
        -f "$ROOT/docker-compose.e2e.yml" \
        --profile e2e
}

compose_down() {
    local project="$1"
    local args=()
    while IFS= read -r arg; do
        args+=("$arg")
    done < <(compose_files)
    if is_true "$DRY_RUN"; then
        log "DRY-RUN: docker compose ${args[*]} -p $project down -v --rmi local --remove-orphans"
        return 0
    fi
    docker compose "${args[@]}" -p "$project" down -v --rmi local --remove-orphans
}

clean_compose_project() {
    local project="$1"
    valid_project "$project" || die "refusing unrecognized project name: $project"
    if [ -n "$BUILD_ID" ] && [[ "$project" != *-"$BUILD_ID" ]]; then
        die "project $project does not match build id $BUILD_ID"
    fi
    if ! project_anchor "$project"; then
        log "no CI-labelled network or volume found for $project; nothing to do"
        return 0
    fi
    log "tearing down validated CI project $project on $DOCKER_HOST"
    compose_down "$project"
}

clean_build_images() {
    local build_id="$1"
    [ -n "$build_id" ] || die "a build id is required"
    local ids
    ids="$(docker images \
        --filter "label=com.vibecode.ci=true" \
        --filter "label=com.vibecode.ci.build=$build_id" \
        --format '{{.ID}}' 2>/dev/null | sort -u)"
    [ -n "$ids" ] || {
        log "no CI images for build $build_id"
        return 0
    }
    local id tag
    for id in $ids; do
        for tag in $(docker image inspect --format '{{range .RepoTags}}{{.}} {{end}}' "$id" 2>/dev/null); do
            case "$tag" in
                *:ci)
                    log "keeping shared alias $tag"
                    ;;
                *)
                    if is_true "$DRY_RUN"; then
                        log "DRY-RUN: docker image rm $tag"
                    else
                        docker image rm "$tag" >/dev/null 2>&1 || true
                        log "removed build tag $tag"
                    fi
                    ;;
            esac
        done
    done
}

age_hours() {
    local created="$1"
    local then now
    then="$(date -d "$created" +%s 2>/dev/null || echo 0)"
    now="$(date +%s)"
    [ "$then" -gt 0 ] || {
        echo 0
        return
    }
    echo $(( (now - then) / 3600 ))
}

orphan_sandbox_containers() {
    local id created running
    while IFS=$'\t' read -r id created running; do
        [ -n "$id" ] || continue
        [ "$running" = "running" ] && continue
        [ "$(age_hours "$created")" -ge "$CONTAINER_GRACE" ] || continue
        if is_true "$DRY_RUN"; then
            log "DRY-RUN: docker rm -f $id (sandbox container)"
        else
            docker rm -f "$id" >/dev/null 2>&1 || true
            log "removed sandbox container $id"
        fi
    done < <(docker ps -a --filter label=vibecode.sandbox.managed=true \
        --format '{{.ID}}\t{{.CreatedAt}}\t{{.State}}' 2>/dev/null)
}

orphan_sandbox_networks() {
    local id created attached
    while IFS=$'\t' read -r id created attached; do
        [ -n "$id" ] || continue
        [ "$attached" != "0" ] && continue
        [ "$(age_hours "$created")" -ge "$CONTAINER_GRACE" ] || continue
        if is_true "$DRY_RUN"; then
            log "DRY-RUN: docker network rm $id (sandbox network)"
        else
            docker network rm "$id" >/dev/null 2>&1 || true
            log "removed sandbox network $id"
        fi
    done < <(docker network ls --filter label=vibecode.sandbox.managed=true \
        --format '{{.ID}}' 2>/dev/null | while read -r id; do
            [ -n "$id" ] || continue
            created="$(docker network inspect --format '{{.Created}}' "$id" 2>/dev/null || echo '')"
            attached="$(docker network inspect --format '{{len .Containers}}' "$id" 2>/dev/null || echo 1)"
            printf '%s\t%s\t%s\n' "$id" "$created" "$attached"
        done)
}

orphan_ci_images() {
    local id created tags tag build
    while IFS=$'\t' read -r id created; do
        [ -n "$id" ] || continue
        tags="$(docker image inspect --format '{{range .RepoTags}}{{.}} {{end}}' "$id" 2>/dev/null || true)"
        build="$(docker image inspect --format '{{index .Config.Labels "com.vibecode.ci.build"}}' "$id" 2>/dev/null || true)"
        [ -n "$build" ] || continue
        [ -n "$CURRENT_BUILD" ] && [ "$build" = "$CURRENT_BUILD" ] && continue
        [ "$(age_hours "$created")" -ge "$IMAGE_GRACE" ] || continue
        for tag in $tags; do
            case "$tag" in
                *:ci)
                    log "keeping shared alias $tag"
                    ;;
                *)
                    if is_true "$DRY_RUN"; then
                        log "DRY-RUN: docker image rm $tag (old CI image)"
                    else
                        docker image rm "$tag" >/dev/null 2>&1 || true
                        log "removed old CI image tag $tag"
                    fi
                    ;;
            esac
        done
    done < <(docker images --filter label=com.vibecode.ci=true \
        --format '{{.ID}}\t{{.CreatedAt}}' 2>/dev/null)
}

orphan_compose_projects() {
    local name status created
    { docker compose ls -a --format json 2>/dev/null || true; } \
        | { grep -o '"Name":"[^"]*"[^}]*' || true; } \
        | sed 's/.*"Name":"\([^"]*\)".*/\1/' \
        | sort -u \
        | while read -r name; do
            [ -n "$name" ] || continue
            valid_project "$name" || continue
            [ "$name" = "${COMPOSE_PROJECT_NAME:-}" ] && continue
            project_anchor "$name" || continue
            [ -n "$(docker ps -q --filter "label=com.docker.compose.project=$name" 2>/dev/null)" ] && continue
            created="$(docker network ls --filter "label=com.docker.compose.project=$name" \
                --format '{{.ID}}' 2>/dev/null | head -n1)"
            [ -n "$created" ] || continue
            created="$(docker network inspect --format '{{.Created}}' "$created" 2>/dev/null || echo '')"
            [ -n "$created" ] || continue
            [ "$(age_hours "$created")" -ge "$BUILD_GRACE" ] || continue
            if is_true "$DRY_RUN"; then
                log "DRY-RUN: docker compose ... -p $name down -v --rmi local --remove-orphans"
            else
                log "removing stopped CI project $name"
                compose_down "$name" || true
            fi
        done
}

legacy_inventory() {
    log "read-only legacy inventory on $DOCKER_HOST"
    echo "== Compose projects =="
    docker compose ls -a 2>/dev/null || true
    echo "== Candidate old projects (review manually) =="
    { docker compose ls -a --format json 2>/dev/null || true; } \
        | { grep -o '"Name":"[^"]*"' || true; } \
        | sed 's/.*"Name":"\([^"]*\)"/\1/' \
        | while read -r name; do
            case "$name" in
                "$LOCAL_PROJECT") echo "EXCLUDED (local dev): $name" ;;
                vibecode-*)
                    if valid_project "$name"; then
                        echo "candidate CI project: $name"
                    else
                        echo "not a CI build project - review only: $name"
                    fi
                    ;;
            esac
        done
    echo "== Images =="
    docker images --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}' 2>/dev/null \
        | while IFS=$'\t' read -r tag id created size; do
            case "$tag" in
                *:ci)
                    echo "shared/current - do not remove: $tag ($id, $created, $size)"
                    ;;
                vibecode-*:[0-9]*)
                    echo "candidate build image tag: $tag ($id, $created, $size)"
                    ;;
                vibecode-*)
                    echo "not a build-unique tag - review only: $tag ($id, $created, $size)"
                    ;;
            esac
        done
    echo "== Sandbox resources =="
    docker ps -a --filter label=vibecode.sandbox.managed=true \
        --format '{{.ID}}\t{{.Names}}\t{{.CreatedAt}}' 2>/dev/null || true
    docker network ls --filter label=vibecode.sandbox.managed=true \
        --format '{{.ID}}\t{{.Name}}\t{{.CreatedAt}}' 2>/dev/null || true
    echo "== Volumes (shared names are excluded) =="
    docker volume ls --format '{{.Name}}\t{{.Driver}}' 2>/dev/null \
        | while IFS=$'\t' read -r name driver; do
            case " $SHARED_VOLUMES " in
                *" $name "*) echo "EXCLUDED (shared volume): $name" ;;
                *)
                    if [[ "$name" == vibecoder-ai-planner_* ]]; then
                        echo "EXCLUDED (local dev volume): $name"
                    elif [[ "$name" =~ ^[0-9a-f]{64}$ ]]; then
                        echo "not project-scoped - review only: $name ($driver)"
                    else
                        echo "candidate volume: $name ($driver)"
                    fi
                    ;;
            esac
        done
    echo "No resources were changed."
}

run_mode() {
    case "$MODE" in
        compose)
            clean_compose_project "$PROJECT"
            ;;
        build-images)
            clean_build_images "$BUILD_ID"
            ;;
        orphans)
            orphan_sandbox_containers
            orphan_sandbox_networks
            orphan_ci_images
            orphan_compose_projects
            ;;
        legacy-inventory)
            legacy_inventory
            ;;
        *)
            die "unsupported mode: $MODE"
            ;;
    esac
}

if [ "$MODE" = "orphans" ]; then
    run_mode
else
    # Compose/build-image post modes are best-effort; never fail the build.
    if ! run_mode; then
        echo "warning: cleanup failed; post-build cleanup is best-effort" >&2
        exit 0
    fi
fi
