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
#   jenkins-docker-cleanup.sh --compose-project NAME --build-id ID --job JOB
#   jenkins-docker-cleanup.sh --build-images ID --job JOB
#   jenkins-docker-cleanup.sh --orphans
#   jenkins-docker-cleanup.sh --legacy-inventory
#
# Environment:
#   CI_DOCKER_HOST            explicit daemon (or --docker-host)
#   CI_DOCKER_DAEMON_ID       expected docker info ID (or --daemon-id)
#   CI_JOB                    Jenkins job name for post-cleanup scoping
#   CI_IMAGE_GRACE_HOURS      default 24
#   CI_CONTAINER_GRACE_HOURS  default 2
#   CI_BUILD_GRACE_HOURS      default 6
#   DRY_RUN                   true/1 for no mutation
#
# Compose/post modes are job-scoped, best-effort and exit 0; --orphans is
# job-agnostic and exits non-zero on a real failure. --legacy-inventory is
# read-only.

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
JOB="${CI_JOB:-${VIBECODE_CI_JOB:-}}"
DRY_RUN="${DRY_RUN:-false}"
DOCKER_HOST="${CI_DOCKER_HOST:-${DOCKER_HOST:-}}"
DAEMON_ID="${CI_DOCKER_DAEMON_ID:-}"
IMAGE_GRACE="${CI_IMAGE_GRACE_HOURS:-24}"
CONTAINER_GRACE="${CI_CONTAINER_GRACE_HOURS:-2}"
BUILD_GRACE="${CI_BUILD_GRACE_HOURS:-6}"
CURRENT_BUILD="${CI_CURRENT_BUILD_ID:-}"
LOCAL_PROJECT="vibecoder-ai-planner"
SHARED_VOLUMES="postgres_data uploads_data vibecode_repos"
FAILURES=0

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

record_failure() {
    echo "error: $*" >&2
    FAILURES=$((FAILURES + 1))
}

# A resource that disappears, or is still held by a container, is a normal
# race. It is not a cleanup failure; a missing file or permission error is.
is_race_error() {
    case "$1" in
        *"No such container"*|*"No such image"*|*"No such network"*)
            return 0
            ;;
        *"No such volume"*|*"No such object"*)
            return 0
            ;;
        *"is in use"*|*"is being used by"*|*"has active endpoints"*)
            return 0
            ;;
        *"already in progress"*)
            return 0
            ;;
    esac
    return 1
}

# Ignore warning lines before classifying a failure. A warning that happens
# to contain a race phrase must not mask the real error on stderr.
is_race_failure() {
    local text="$1"
    local errors
    # Covers the plain `WARNING:` form and Docker Compose's logrus form:
    # time="..." level=warning msg="..." / WARN[0000] ...
    errors="$(printf '%s\n' "$text" \
        | grep -viE '(^[[:space:]]*(warning:|warn\[))|(level=(warning|warn)([^[:alnum:]_]|$))' \
        || true)"
    [ -n "$errors" ] || return 1
    is_race_error "$errors"
}

ERR_FILE=""
CAPTURE_ERR=""

cleanup_err_file() {
    if [ -n "$ERR_FILE" ]; then
        rm -f "$ERR_FILE"
    fi
}
trap cleanup_err_file EXIT

# Run a command with stdout and stderr separated. Docker warnings often go to
# stderr; treating them as resource IDs or as anchor output is unsafe.
capture() {
    local var="$1"
    shift
    if [ -z "$ERR_FILE" ]; then
        ERR_FILE="$(mktemp "${TMPDIR:-/tmp}/jenkins-docker-cleanup.XXXXXX")"
    fi
    : > "$ERR_FILE"
    local out
    if out="$("$@" 2>"$ERR_FILE")"; then
        printf -v "$var" '%s' "$out"
        CAPTURE_ERR="$(<"$ERR_FILE")"
        return 0
    fi
    CAPTURE_ERR="$(<"$ERR_FILE")"
    printf -v "$var" '%s' "$out"
    return 1
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
        --job)
            [ $# -ge 2 ] || die "--job requires a value"
            JOB="$2"
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
# Build numbers are unique only within a Jenkins job. Post cleanup must carry
# the job identity or it could remove another job's resources from a shared
# daemon. The scheduled GC stays job-agnostic and does not require this.
if [ "$MODE" = "compose" ] || [ "$MODE" = "build-images" ]; then
    [ -n "$JOB" ] || die "--job/CI_JOB is required for post-build cleanup"
    if [ "$MODE" = "compose" ]; then
        [ -n "$BUILD_ID" ] || die "--build-id is required with --compose-project"
    fi
else
    # --orphans and --legacy-inventory are job-agnostic even if a controller
    # exports CI_JOB into the scheduled job's environment.
    JOB=""
fi

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
    local filters=(
        --filter "label=com.docker.compose.project=$project"
        --filter "label=com.vibecode.ci=true"
    )
    if [ -n "$JOB" ]; then
        filters+=(--filter "label=com.vibecode.ci.job=$JOB")
    fi
    if [ -n "$BUILD_ID" ]; then
        filters+=(--filter "label=com.vibecode.ci.build=$BUILD_ID")
    fi
    local listed
    if ! capture listed docker network ls "${filters[@]}" --format '{{.ID}}'; then
        record_failure "docker network ls failed for project $project: ${CAPTURE_ERR:-unknown error}"
        return 1
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker network ls for $project: $CAPTURE_ERR"
    fi
    if printf '%s\n' "$listed" | grep -q .; then
        return 0
    fi
    if ! capture listed docker volume ls "${filters[@]}" --format '{{.Name}}'; then
        record_failure "docker volume ls failed for project $project: ${CAPTURE_ERR:-unknown error}"
        return 1
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker volume ls for $project: $CAPTURE_ERR"
    fi
    if printf '%s\n' "$listed" | grep -q .; then
        return 0
    fi
    return 1
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
    local output
    if capture output docker compose "${args[@]}" -p "$project" down -v --rmi local \
        --remove-orphans; then
        if [ -n "$CAPTURE_ERR" ]; then
            log "warning: compose teardown for $project: $CAPTURE_ERR"
        fi
        log "compose teardown completed for $project"
    else
        if is_race_failure "$CAPTURE_ERR"; then
            log "warning: compose teardown for $project hit a concurrent-removal race"
        else
            record_failure "docker compose down failed for $project: ${CAPTURE_ERR:-unknown error}"
            return 1
        fi
    fi
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

remove_image_tag() {
    local tag="$1"
    local reason="$2"
    [ -n "$tag" ] || return 0
    if is_true "$DRY_RUN"; then
        log "DRY-RUN: docker image rm $tag ($reason)"
        return 0
    fi
    local output
    if output="$(docker image rm "$tag" 2>&1)"; then
        log "removed image tag $tag ($reason)"
    else
        if is_race_failure "$output"; then
            log "warning: image tag $tag disappeared or is still in use; leaving it"
        else
            record_failure "docker image rm $tag failed: $output"
        fi
    fi
}

remove_image_id() {
    local id="$1"
    local reason="$2"
    [ -n "$id" ] || return 0
    if is_true "$DRY_RUN"; then
        log "DRY-RUN: docker image rm $id ($reason)"
        return 0
    fi
    local output
    if output="$(docker image rm "$id" 2>&1)"; then
        log "removed image $id ($reason)"
    else
        if is_race_failure "$output"; then
            log "warning: image $id disappeared or is still in use; leaving it"
        else
            record_failure "docker image rm $id failed: $output"
        fi
    fi
}

clean_build_images() {
    local build_id="$1"
    [ -n "$build_id" ] || die "a build id is required"
    [ -n "$JOB" ] || die "a job name is required"
    local listing ids
    if ! capture listing docker images -a \
        --filter "label=com.vibecode.ci=true" \
        --filter "label=com.vibecode.ci.job=$JOB" \
        --filter "label=com.vibecode.ci.build=$build_id" \
        --format '{{.ID}}'; then
        record_failure "docker images failed for job $JOB build $build_id: ${CAPTURE_ERR:-unknown error}"
        return 0
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker images for job $JOB build $build_id: $CAPTURE_ERR"
    fi
    ids="$(printf '%s\n' "$listing" | sort -u)"
    [ -n "$(printf '%s' "$ids" | tr -d '[:space:]')" ] || {
        log "no CI images for job $JOB build $build_id"
        return 0
    }
    local id tag tags remaining
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        if ! capture tags docker image inspect --format \
            '{{range .RepoTags}}{{.}} {{end}}' "$id"; then
            if is_race_failure "$CAPTURE_ERR"; then
                log "warning: tags for $id are unavailable; skipping"
            else
                record_failure "docker image inspect $id failed: ${CAPTURE_ERR:-unknown error}"
            fi
            continue
        fi
        if [ -n "$CAPTURE_ERR" ]; then
            log "warning: docker image inspect $id: $CAPTURE_ERR"
        fi
        remaining=""
        for tag in $tags; do
            case "$tag" in
                *:ci)
                    remaining="$remaining $tag"
                    log "keeping shared alias $tag"
                    ;;
                *:"$build_id")
                    remove_image_tag "$tag" "build $build_id tag"
                    ;;
                *)
                    # Keep unrelated aliases such as :latest.
                    remaining="$remaining $tag"
                    log "keeping unrelated alias $tag"
                    ;;
            esac
        done
        if [ -z "${remaining// /}" ]; then
            remove_image_id "$id" \
                "job $JOB build $build_id image has no remaining tags"
        fi
    done <<< "$ids"
}

# Docker CLI timestamps look like "2020-01-01 00:00:00.123 +0000 UTC",
# volume timestamps are RFC3339, and BusyBox date accepts only
# "YYYY-MM-DD HH:MM:SS". Normalize to the portable form.
normalize_timestamp() {
    local value="$1"
    value="${value%Z}"
    value="${value% UTC}"
    value="${value% [+-]0000}"
    value="${value%[+-]0000}"
    value="${value% [+-]00:00}"
    value="${value%[+-]00:00}"
    value="${value/T/ }"
    value="${value%%.*}"
    printf '%s' "$value"
}

age_hours() {
    local created
    created="$(normalize_timestamp "$1")"
    local then now
    then="$(date -u -d "$created" +%s 2>/dev/null || echo 0)"
    now="$(date +%s)"
    [ "$then" -gt 0 ] || {
        echo 0
        return
    }
    echo $(( (now - then) / 3600 ))
}

orphan_sandbox_containers() {
    local listing id created output
    if ! capture listing docker ps -a --filter label=vibecode.sandbox.managed=true \
        --format '{{.ID}}\t{{.CreatedAt}}'; then
        record_failure "docker ps failed for the sandbox orphan scan: ${CAPTURE_ERR:-unknown error}"
        return 0
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker ps for the sandbox orphan scan: $CAPTURE_ERR"
    fi
    while IFS=$'\t' read -r id created _; do
        [ -n "$id" ] || continue
        # A hard-killed Jenkins run leaves containers running. The grace
        # period is longer than the pipeline timeout, so an old running
        # sandbox is an orphan and is removed like a stopped one.
        [ "$(age_hours "$created")" -ge "$CONTAINER_GRACE" ] || continue
        if is_true "$DRY_RUN"; then
            log "DRY-RUN: docker rm -f $id (sandbox container)"
            continue
        fi
        if output="$(docker rm -f "$id" 2>&1)"; then
            log "removed sandbox container $id"
        else
            if is_race_failure "$output"; then
                log "warning: sandbox container $id disappeared or is still in use"
            else
                record_failure "docker rm -f $id failed: $output"
            fi
        fi
    done <<< "$listing"
}

orphan_sandbox_networks() {
    local listing id created output
    if ! capture listing docker network ls --filter label=vibecode.sandbox.managed=true \
        --format '{{.ID}}'; then
        record_failure "docker network ls failed for the sandbox orphan scan: ${CAPTURE_ERR:-unknown error}"
        return 0
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker network ls for the sandbox orphan scan: $CAPTURE_ERR"
    fi
    while IFS= read -r id; do
        [ -n "$id" ] || continue
        if ! capture created docker network inspect --format '{{.Created}}' "$id"; then
            if is_race_failure "$CAPTURE_ERR"; then
                log "warning: sandbox network $id disappeared before inspection"
            else
                record_failure "docker network inspect $id failed: ${CAPTURE_ERR:-unknown error}"
            fi
            continue
        fi
        if [ -n "$CAPTURE_ERR" ]; then
            log "warning: docker network inspect $id: $CAPTURE_ERR"
        fi
        [ -n "$created" ] || continue
        # Containers are removed first; docker network rm still fails safely
        # if a younger container is attached.
        [ "$(age_hours "$created")" -ge "$CONTAINER_GRACE" ] || continue
        if is_true "$DRY_RUN"; then
            log "DRY-RUN: docker network rm $id (sandbox network)"
            continue
        fi
        if output="$(docker network rm "$id" 2>&1)"; then
            log "removed sandbox network $id"
        else
            if is_race_failure "$output"; then
                log "warning: sandbox network $id still has an attached container; leaving it"
            else
                record_failure "docker network rm $id failed: $output"
            fi
        fi
    done <<< "$listing"
}

orphan_ci_images() {
    local listing id created tags tag build has_ci remaining
    if ! capture listing docker images -a --filter label=com.vibecode.ci=true \
        --format '{{.ID}}\t{{.CreatedAt}}'; then
        record_failure "docker images failed for the orphan image scan: ${CAPTURE_ERR:-unknown error}"
        return 0
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker images for the orphan image scan: $CAPTURE_ERR"
    fi
    while IFS=$'\t' read -r id created; do
        [ -n "$id" ] || continue
        # A failed tag inspect must never be read as "no :ci alias". Skip the
        # image unless Docker positively confirms the tag list.
        if ! capture tags docker image inspect --format \
            '{{range .RepoTags}}{{.}} {{end}}' "$id"; then
            if is_race_failure "$CAPTURE_ERR"; then
                log "warning: tags for $id are unavailable; skipping (cannot prove :ci is absent)"
            else
                record_failure "docker image inspect $id failed: ${CAPTURE_ERR:-unknown error}"
            fi
            continue
        fi
        if [ -n "$CAPTURE_ERR" ]; then
            log "warning: docker image inspect $id: $CAPTURE_ERR"
        fi
        if ! capture build docker image inspect --format \
            '{{index .Config.Labels "com.vibecode.ci.build"}}' "$id"; then
            if is_race_failure "$CAPTURE_ERR"; then
                log "warning: build label for $id is unavailable; skipping"
            else
                record_failure "docker image inspect $id failed: ${CAPTURE_ERR:-unknown error}"
            fi
            continue
        fi
        if [ -n "$CAPTURE_ERR" ]; then
            log "warning: docker image inspect $id: $CAPTURE_ERR"
        fi
        [ -n "$build" ] || continue
        [ -n "$CURRENT_BUILD" ] && [ "$build" = "$CURRENT_BUILD" ] && continue
        [ "$(age_hours "$created")" -ge "$IMAGE_GRACE" ] || continue
        has_ci=false
        remaining=""
        for tag in $tags; do
            local repo="${tag%:*}"
            case "$tag" in
                *:ci)
                    has_ci=true
                    remaining="$remaining $tag"
                    log "keeping shared alias $tag"
                    ;;
                *:"$build")
                    remove_image_tag "$tag" "old CI image tag for build $build"
                    ;;
                *)
                    case "$repo" in
                        vibecode-*-"$build"-*)
                            # Compose-built images embed the project name
                            # (which ends in the build id) in the repository
                            # part, not in the tag.
                            remove_image_tag "$tag" \
                                "old Compose project image for build $build"
                            ;;
                        *)
                            # Preserve unrelated aliases such as :latest.
                            remaining="$remaining $tag"
                            log "keeping unrelated alias $tag"
                            ;;
                    esac
                    ;;
            esac
        done
        if [ "$has_ci" = "false" ] && [ -z "${remaining// /}" ]; then
            remove_image_id "$id" "old CI image with no :ci alias"
        fi
    done <<< "$listing"
}

# Determine a project's age from its network, or from a volume when the
# project is a partial leftover with no network. Sets the variable named by
# the second argument.
project_created() {
    local name="$1"
    local var="$2"
    local id found
    if capture id docker network ls \
        --filter "label=com.docker.compose.project=$name" \
        --format '{{.ID}}'; then
        id="$(printf '%s\n' "$id" | head -n1)"
        if [ -n "$id" ]; then
            if capture found docker network inspect --format '{{.Created}}' "$id"; then
                if [ -n "$found" ] && [ "$found" != "<no value>" ]; then
                    printf -v "$var" '%s' "$found"
                    return 0
                fi
            elif ! is_race_failure "$CAPTURE_ERR"; then
                record_failure "docker network inspect failed for $name: ${CAPTURE_ERR:-unknown error}"
            fi
        fi
    elif ! is_race_failure "$CAPTURE_ERR"; then
        record_failure "docker network ls failed for $name: ${CAPTURE_ERR:-unknown error}"
    fi
    if capture id docker volume ls \
        --filter "label=com.docker.compose.project=$name" \
        --format '{{.Name}}'; then
        id="$(printf '%s\n' "$id" | head -n1)"
        if [ -n "$id" ]; then
            if capture found docker volume inspect --format '{{.CreatedAt}}' "$id"; then
                if [ -n "$found" ] && [ "$found" != "<no value>" ]; then
                    printf -v "$var" '%s' "$found"
                    return 0
                fi
            elif ! is_race_failure "$CAPTURE_ERR"; then
                record_failure "docker volume inspect failed for $name: ${CAPTURE_ERR:-unknown error}"
            fi
        fi
    elif ! is_race_failure "$CAPTURE_ERR"; then
        record_failure "docker volume ls failed for $name: ${CAPTURE_ERR:-unknown error}"
    fi
    return 1
}

orphan_compose_projects() {
    local listing names name created
    if ! capture listing docker compose ls -a --format json; then
        record_failure "docker compose ls failed for the orphan project scan: ${CAPTURE_ERR:-unknown error}"
        return 0
    fi
    if [ -n "$CAPTURE_ERR" ]; then
        log "warning: docker compose ls for the orphan project scan: $CAPTURE_ERR"
    fi
    names="$(printf '%s' "$listing" \
        | { grep -o '"Name":"[^"]*"' || true; } \
        | sed 's/.*"Name":"\([^"]*\)"/\1/' \
        | sort -u)"
    while IFS= read -r name; do
        [ -n "$name" ] || continue
        valid_project "$name" || continue
        [ "$name" = "${COMPOSE_PROJECT_NAME:-}" ] && continue
        project_anchor "$name" || continue
        # Hard-killed builds can leave running containers. The build grace
        # period is longer than the pipeline timeout; compose down below
        # stops and removes them. A volume-only partial project is aged from
        # the volume's CreatedAt.
        if ! project_created "$name" created; then
            log "warning: cannot determine the creation time for $name; skipping"
            continue
        fi
        [ "$(age_hours "$created")" -ge "$BUILD_GRACE" ] || continue
        if is_true "$DRY_RUN"; then
            log "DRY-RUN: docker compose ... -p $name down -v --rmi local --remove-orphans"
        else
            log "removing old CI project $name"
            compose_down "$name" || true
        fi
    done <<< "$names"
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
    docker images -a --format '{{.Repository}}:{{.Tag}}\t{{.ID}}\t{{.CreatedAt}}\t{{.Size}}' 2>/dev/null \
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
    echo "== Dangling images (review only) =="
    docker images -a --filter dangling=true \
        --format '{{.ID}}\t{{.CreatedAt}}\t{{.Size}}' 2>/dev/null \
        | while IFS=$'\t' read -r id created size; do
            [ -n "$id" ] || continue
            ci="$(docker image inspect --format '{{index .Config.Labels "com.vibecode.ci"}}' "$id" 2>/dev/null || true)"
            if [ "$ci" = "true" ]; then
                echo "dangling CI image - review only: $id ($created, $size)"
            else
                echo "dangling image - unrelated: $id ($created, $size)"
            fi
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
                    elif [[ "$name" == vibecode-* ]]; then
                        echo "candidate volume: $name ($driver)"
                    else
                        echo "unrelated volume - review only: $name ($driver)"
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
    run_mode || true
    if [ "$FAILURES" -gt 0 ]; then
        echo "error: $FAILURES Docker operation(s) failed during the orphan scan" >&2
        exit 1
    fi
else
    # Compose/build-image post modes are best-effort; never fail the build.
    if ! run_mode; then
        echo "warning: cleanup failed; post-build cleanup is best-effort" >&2
    fi
    if [ "$FAILURES" -gt 0 ]; then
        echo "warning: $FAILURES Docker operation(s) failed; post-build cleanup is best-effort" >&2
    fi
    exit 0
fi
