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
        work=$(pwd)/smoke
        rm -rf "$work" && mkdir -p "$work"
        cd "$work"
        printf "pytest\n" > requirements.txt
        pip install --no-index -r requirements.txt
        # A local wheel proves the venv is writable as uid 1000; skip a
        # preinstalled pytest because that only proves the command resolves.
        mkdir -p wheelhouse smoke_pkg-0.0.1.dist-info
        printf "Metadata-Version: 2.1\nName: smoke-pkg\nVersion: 0.0.1\n" \
            > smoke_pkg-0.0.1.dist-info/METADATA
        printf "Wheel-Version: 1.0\nGenerator: vibecode-smoke\nRoot-Is-Purelib: true\nTag: py3-none-any\n" \
            > smoke_pkg-0.0.1.dist-info/WHEEL
        printf "def ok():\n    return True\n" > smoke_pkg.py
        printf "smoke_pkg.py,,\nsmoke_pkg-0.0.1.dist-info/METADATA,,\nsmoke_pkg-0.0.1.dist-info/WHEEL,,\n" \
            > smoke_pkg-0.0.1.dist-info/RECORD
        python3 -m zipfile -c wheelhouse/smoke_pkg-0.0.1-py3-none-any.whl \
            smoke_pkg.py smoke_pkg-0.0.1.dist-info
        pip install --no-index --find-links wheelhouse smoke-pkg
        # Remove the source so the import and pytest resolve the installed
        # wheel, not ./smoke_pkg.py.
        rm -f smoke_pkg.py
        cd /tmp
        /opt/venv/bin/python -c "import smoke_pkg; assert smoke_pkg.__file__.startswith(\"/opt/venv/\") and smoke_pkg.ok()"
        cd "$work"
        printf "import smoke_pkg\n\ndef test_smoke():\n    assert smoke_pkg.ok()\n" > test_smoke.py
        pytest -q
    '
done

echo "all stack smoke tests passed"
