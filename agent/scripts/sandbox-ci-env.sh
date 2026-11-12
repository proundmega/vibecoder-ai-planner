#!/usr/bin/env bash
#
# Source this from Jenkins Docker stages so every stage selects the same
# daemon and the same host-visible workspace path.
#
# Exports:
#   DOCKER_HOST               local Docker socket when available, otherwise
#                             the resolved Jenkins DOCKER_HOST
#   JENKINS_HOST_HOME         host path mounted at JENKINS_HOME
#   SANDBOX_CI_HOST_WORKSPACE host path for $WORKSPACE
#
# Set JENKINS_HOST_HOME when the daemon cannot inspect the Jenkins container
# (or when the host path is not discoverable from its mount table).
# shellcheck shell=bash

SANDBOX_CI_ORIGINAL_DOCKER_HOST="${DOCKER_HOST:-}"
SANDBOX_CI_ORIGINAL_DOCKER_HOST_FALLBACK="${DOCKER_HOST_FALLBACK:-}"

if DOCKER_HOST=unix:///var/run/docker.sock docker info >/dev/null 2>&1; then
    export DOCKER_HOST=unix:///var/run/docker.sock
    echo "Using the local Docker socket" >&2
else
    echo "Local Docker socket unavailable; using Jenkins DOCKER_HOST=$SANDBOX_CI_ORIGINAL_DOCKER_HOST" >&2
    if [[ "$SANDBOX_CI_ORIGINAL_DOCKER_HOST" == tcp://* ]]; then
        host="${SANDBOX_CI_ORIGINAL_DOCKER_HOST#tcp://}"
        port="${host##*:}"
        host="${host%:*}"
        ip="$(getent hosts "$host" 2>/dev/null | awk '{print $1}')"
        if [[ -n "$ip" ]]; then
            export DOCKER_HOST="tcp://$ip:$port"
        elif [[ -n "$SANDBOX_CI_ORIGINAL_DOCKER_HOST_FALLBACK" ]]; then
            export DOCKER_HOST="$SANDBOX_CI_ORIGINAL_DOCKER_HOST_FALLBACK"
        else
            export DOCKER_HOST="$SANDBOX_CI_ORIGINAL_DOCKER_HOST"
        fi
    else
        export DOCKER_HOST="$SANDBOX_CI_ORIGINAL_DOCKER_HOST"
    fi
fi

JENKINS_HOME_DIR="${JENKINS_HOME:-/var/jenkins_home}"
HOST_JENKINS_HOME="${JENKINS_HOST_HOME:-}"
if [[ -z "$HOST_JENKINS_HOME" ]]; then
    # Inspect through the original daemon: the selected daemon may not be able
    # to see the Jenkins agent container.
    if [[ -n "$SANDBOX_CI_ORIGINAL_DOCKER_HOST" ]]; then
        HOST_JENKINS_HOME="$(DOCKER_HOST="$SANDBOX_CI_ORIGINAL_DOCKER_HOST" docker inspect "$(hostname)" \
            --format '{{range .Mounts}}{{if eq .Destination "'"$JENKINS_HOME_DIR"'"}}{{.Source}}{{end}}{{end}}' \
            2>/dev/null || true)"
    else
        HOST_JENKINS_HOME="$(docker inspect "$(hostname)" \
            --format '{{range .Mounts}}{{if eq .Destination "'"$JENKINS_HOME_DIR"'"}}{{.Source}}{{end}}{{end}}' \
            2>/dev/null || true)"
    fi
fi
if [[ -z "$HOST_JENKINS_HOME" ]]; then
    # A non-containerized Jenkins needs no path translation.
    HOST_JENKINS_HOME="$JENKINS_HOME_DIR"
fi
export JENKINS_HOST_HOME="$HOST_JENKINS_HOME"

if [[ -n "${WORKSPACE:-}" ]]; then
    if [[ "$WORKSPACE" == "$JENKINS_HOME_DIR"/* ]]; then
        SANDBOX_CI_HOST_WORKSPACE="${HOST_JENKINS_HOME}${WORKSPACE#"$JENKINS_HOME_DIR"}"
    else
        SANDBOX_CI_HOST_WORKSPACE="$WORKSPACE"
    fi
    export SANDBOX_CI_HOST_WORKSPACE
fi
