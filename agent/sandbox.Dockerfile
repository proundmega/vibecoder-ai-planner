# Runtime image for fg-34 sandboxes.
#
# The supervisor launches one disposable container per ticket from this image.
# It only needs the toolchain used by repo verification commands; the session
# supervisor (Java/OpenCode) stays outside.
#
# Build:
#   docker build -f agent/sandbox.Dockerfile -t vibecode-agent-sandbox:latest agent
#
# Base images must be pinned by digest before this is a production default
# (fg-34 FR9). The node:24-alpine tag is a development convenience for now.
FROM node:24-alpine

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
