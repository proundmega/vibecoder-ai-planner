#!/usr/bin/env bash
#
# Build the fg-34 sandbox images and run the real-Docker integration suite.
#
# Jenkins runs this in the Sandbox Integration stage (D13). The same command
# works locally; Docker must be reachable and the current user must be able to
# run containers.
#
# Usage:
#   scripts/sandbox-integration-test.sh
#
# Environment:
#   SANDBOX_IT_IMAGE          sandbox image tag (default: vibecode-agent-sandbox:ci)
#   SANDBOX_IT_PROXY_IMAGE    proxy image tag (default: vibecode-sandbox-proxy:ci)
#   SANDBOX_IT_NETWORK        "1" also runs the egress allowlist test (default: 0)
#   SANDBOX_IT_NETWORK_IMAGE  sandbox image for the egress test (default: SANDBOX_IT_IMAGE)
#   SANDBOX_IT_BUILD          "0" skips the image builds
#   SANDBOX_IT_BUILD_TAG      optional build-unique tag (defaults to VIBECODE_CI_BUILD)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
IMAGE="${SANDBOX_IT_IMAGE:-vibecode-agent-sandbox:ci}"
PROXY_IMAGE="${SANDBOX_IT_PROXY_IMAGE:-vibecode-sandbox-proxy:ci}"
BUILD_TAG="${SANDBOX_IT_BUILD_TAG:-${VIBECODE_CI_BUILD:-}}"
CI_LABEL="${VIBECODE_CI:-false}"
CI_JOB="${VIBECODE_CI_JOB:-}"
CI_BUILD="${VIBECODE_CI_BUILD:-}"

build_image() {
    local dockerfile="$1"
    local image="$2"
    local args=(--load -f "${ROOT}/${dockerfile}" -t "${image}")
    if [[ -n "${BUILD_TAG}" ]]; then
        args+=(-t "${image%:*}:${BUILD_TAG}")
    fi
    args+=(
        --label "com.vibecode.ci=${CI_LABEL}"
        --label "com.vibecode.ci.job=${CI_JOB}"
        --label "com.vibecode.ci.build=${CI_BUILD}"
    )
    docker build "${args[@]}" "${ROOT}"
}

if [[ "${SANDBOX_IT_BUILD:-1}" != "0" ]]; then
    # Docker's buildx docker-container driver keeps the result in the build
    # cache unless --load is requested; the integration tests need the tag in
    # the local image store. This requires a buildx-capable CLI (Docker 23+).
    echo "Building sandbox image ${IMAGE}"
    build_image sandbox.Dockerfile "${IMAGE}"
    echo "Building sandbox proxy image ${PROXY_IMAGE}"
    build_image sandbox-proxy.Dockerfile "${PROXY_IMAGE}"
    for image in "${IMAGE}" "${PROXY_IMAGE}"; do
        if ! docker image inspect "${image}" >/dev/null 2>&1; then
            echo "error: ${image} is not present after the build" >&2
            docker info >&2 || true
            docker images >&2 || true
            exit 1
        fi
    done
fi

echo "Docker daemon for the integration suite: $(docker info --format '{{.Name}}' 2>/dev/null || echo unknown)"

if [[ -n "${SANDBOX_HOST_WORKSPACE_ROOT:-}" \
    && -n "${SANDBOX_IT_WORKSPACE_ROOT:-}" ]]; then
    host_check=".sandbox-host-check-$$"
    printf 'ok\n' > "${SANDBOX_IT_WORKSPACE_ROOT}/${host_check}"
    if ! docker run --rm -v "${SANDBOX_HOST_WORKSPACE_ROOT}:/check:ro" "${IMAGE}" \
        sh -c "test -f /check/${host_check}" >/dev/null 2>&1; then
        echo "error: ${SANDBOX_HOST_WORKSPACE_ROOT} is not visible to the Docker daemon" >&2
        echo "Check JENKINS_HOST_HOME/SANDBOX_HOST_WORKSPACE_ROOT." >&2
        rm -f "${SANDBOX_IT_WORKSPACE_ROOT}/${host_check}"
        docker info >&2 || true
        exit 1
    fi
    rm -f "${SANDBOX_IT_WORKSPACE_ROOT}/${host_check}"
fi

export SANDBOX_IT_IMAGE="${IMAGE}"
export SANDBOX_IT_PROXY_IMAGE="${PROXY_IMAGE}"
if [[ "${SANDBOX_IT_NETWORK:-0}" == "1" ]]; then
    export SANDBOX_IT_NETWORK_IMAGE="${SANDBOX_IT_NETWORK_IMAGE:-${IMAGE}}"
fi

cd "${ROOT}"
mvn -Dtest=DockerSandboxRunnerIntegrationTest test
