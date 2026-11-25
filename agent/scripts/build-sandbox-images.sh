#!/usr/bin/env bash
#
# Build the fg-39 prebuilt per-stack sandbox images.
#
# Every stage in sandbox-stacks.Dockerfile is pinned by base-image digest.
# Publish each tag, then set REPO_PROFILE_STACK_IMAGES on the API to the
# digest-pinned references so stack detection can propose them.
#
# Usage:
#   scripts/build-sandbox-images.sh [--tag TAG]
#   scripts/build-sandbox-images.sh --check-pins
#
# Environment:
#   SANDBOX_STACK_TAG   image tag (default: latest)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/sandbox-stacks.Dockerfile"
TAG="${SANDBOX_STACK_TAG:-latest}"
TARGETS=(node python java go monorepo)

usage() {
    cat <<'EOF'
Build the fg-39 per-stack sandbox images.

Usage:
  scripts/build-sandbox-images.sh [--tag TAG]
  scripts/build-sandbox-images.sh --check-pins

Smoke-test the Python/monorepo images with:
  scripts/smoke-sandbox-stacks.sh

Environment:
  SANDBOX_STACK_TAG   image tag (default: latest)

After publishing, set REPO_PROFILE_STACK_IMAGES on the API, for example:
  {"node":"registry.example/vibecode-sandbox-node:latest@sha256:...",
   "python":"registry.example/vibecode-sandbox-python:latest@sha256:..."}
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    usage
    exit 0
fi

if [[ "${1:-}" == "--check-pins" ]]; then
    exec "$ROOT/scripts/sandbox-image-security.sh" \
        --check-pins --dockerfile "$DOCKERFILE"
fi

if [[ "${1:-}" == "--tag" ]]; then
    if [[ -z "${2:-}" ]]; then
        echo "error: --tag needs a value" >&2
        exit 2
    fi
    TAG="$2"
elif [[ $# -gt 0 ]]; then
    echo "error: unknown argument: $1" >&2
    usage >&2
    exit 2
fi

for target in "${TARGETS[@]}"; do
    image="vibecode-sandbox-${target}:${TAG}"
    echo "building ${image} (target ${target})"
    docker build \
        --target "$target" \
        --file "$DOCKERFILE" \
        --tag "$image" \
        "$ROOT"
    docker image inspect --format '  id={{.Id}}' "$image"
done

cat <<'EOF'

Built all stack images. Smoke-test Python and monorepo with:
  scripts/smoke-sandbox-stacks.sh --no-build

Publish them (for example with docker push), then pin:
  docker buildx imagetools inspect <image>
and set REPO_PROFILE_STACK_IMAGES to the @sha256 references.
EOF
