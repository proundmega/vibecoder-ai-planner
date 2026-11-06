# Runtime image for fg-34 sandboxes.
#
# The supervisor launches one disposable container per ticket from this image.
# It only needs the toolchain used by repo verification commands; the session
# supervisor (Java/OpenCode) stays outside.
#
# Build:
#   docker build -f agent/sandbox.Dockerfile -t vibecode-agent-sandbox:latest agent
#
# Base image is pinned by digest (fg-34 FR9). Update the digest deliberately
# when upgrading; run `agent/scripts/sandbox-image-security.sh --check-pins`.
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

RUN apk add --no-cache \
        git \
        bash \
        ripgrep \
        curl \
        jq \
        python3 \
        build-base \
        libstdc++ \
        ca-certificates

WORKDIR /workspace

# The official node image already provides uid/gid 1000; the runner overrides
# --user to match the workspace owner.
USER 1000:1000
