#!/usr/bin/env bash
#
# Smoke-test the prebuilt stack images under the sandbox's non-root user and
# sanitized PATH (fg-39 FR3 / D7).
#
# The supervisor replaces PATH with
#   /usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# so this asserts that each stack's default commands resolve without a shell
# profile or ~/.local/bin, and that `pip install` + `pytest` work as uid 1000
# for the Python and monorepo images.
#
# Usage:
#   scripts/smoke-sandbox-stacks.sh [--no-build]
#
# Environment:
#   SANDBOX_STACK_TAG   image tag (default: latest)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/sandbox-stacks.Dockerfile"
TAG="${SANDBOX_STACK_TAG:-latest}"
BUILD=1
TARGETS=(node python java go monorepo)
SANITIZED_PATH="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

if [[ "${1:-}" == "--no-build" ]]; then
    BUILD=0
elif [[ $# -gt 0 ]]; then
    echo "error: unknown argument: $1" >&2
    exit 2
fi

run() {
    local image="$1"
    shift
    docker run --rm --network none --user 1000:1000 --workdir /tmp "$image" \
        env -i PATH="$SANITIZED_PATH" HOME=/tmp TMPDIR=/tmp "$@"
}

for target in "${TARGETS[@]}"; do
    image="vibecode-sandbox-${target}:${TAG}"
    if [[ "$BUILD" == "1" ]]; then
        echo "building ${image}"
        docker build \
            --target "$target" \
            --file "$DOCKERFILE" \
            --tag "$image" \
            "$ROOT" >/dev/null
    fi
done

echo "checking default toolchains under the sanitized PATH"
run vibecode-sandbox-node:${TAG} sh -c 'node --version; npm --version'
run vibecode-sandbox-python:${TAG} sh -c 'python3 --version; pip --version; pytest --version | head -1'
run vibecode-sandbox-java:${TAG} sh -c 'java -version 2>&1 | head -1; mvn -version 2>&1 | head -1'
run vibecode-sandbox-go:${TAG} sh -c 'go version'
run vibecode-sandbox-monorepo:${TAG} sh -c '
    node --version
    python3 --version
    java -version 2>&1 | head -1
    mvn -version 2>&1 | head -1
    go version
    pip --version
    pytest --version | head -1
'

for target in python monorepo; do
    image="vibecode-sandbox-${target}:${TAG}"
    echo "smoke-testing ${image} pip/pytest as uid 1000"
    run "$image" sh -c '
        set -eu
        rm -rf smoke && mkdir smoke && cd smoke
        printf "pytest\n" > requirements.txt
        pip install --no-index -r requirements.txt
        printf "def test_smoke():\n    assert True\n" > test_smoke.py
        pytest -q
    '
done

echo "all stack smoke tests passed"
