# Prebuilt per-stack sandbox images (fg-39 FR3 / D7).
#
# One file, one stage per stack. Build a stage with:
#   docker build -f agent/sandbox-stacks.Dockerfile --target node -t vibecode-sandbox-node:latest agent
# or use the helper: agent/scripts/build-sandbox-images.sh
#
# Every base image is pinned by digest. The helper script and
# `agent/scripts/sandbox-image-security.sh --check-pins` enforce that.
# Publish each stage and set REPO_PROFILE_STACK_IMAGES so stack detection can
# propose the digest-pinned image:
#   REPO_PROFILE_STACK_IMAGES='{"node":"...@sha256:...","python":"...@sha256:..."}'
#
# The monorepo stage assembles the same pinned toolchains as the per-stack
# stages (Node 24, Python 3.12, Java 21 + Maven 3.9.11, Go 1.23) from their
# pinned images. The Python stages expose pip/pytest through /usr/local/bin so
# they work under the supervisor's sanitized PATH.

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS node
LABEL com.vibecode.sandbox.stack="node"
LABEL com.vibecode.sandbox.toolchains="node=24,npm=11,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /workspace && chown -R 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000

FROM python:3.12-slim-bookworm@sha256:44cf1793efa7c7a476bb0f2cff81443f4a072c90c1cb127e2924933daa3e8c64 AS python
LABEL com.vibecode.sandbox.stack="python"
LABEL com.vibecode.sandbox.toolchains="python=3.12,pytest,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN if ! getent group 1000 >/dev/null; then groupadd -g 1000 sandbox; fi \
    && if ! getent passwd 1000 >/dev/null; then useradd -u 1000 -g 1000 -m -s /bin/bash sandbox; fi
# The supervisor forces a fixed PATH that does not include ~/.local/bin or
# /opt/venv/bin. A uid-1000-owned venv keeps pip installs writable, and the
# console scripts are exposed through /usr/local/bin, which is on that PATH.
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --disable-pip-version-check pytest \
    && chown -R 1000:1000 /opt/venv \
    && ln -sf /opt/venv/bin/pip /usr/local/bin/pip \
    && ln -sf /opt/venv/bin/pip3 /usr/local/bin/pip3 \
    && ln -sf /opt/venv/bin/pytest /usr/local/bin/pytest \
    && mkdir -p /workspace && chown -R 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000

FROM maven:3.9.11-eclipse-temurin-21@sha256:6fdc855a6ed81d288ca7ca37ac6ff5e9308b612485c0801d70b25a858c83d237 AS java
LABEL com.vibecode.sandbox.stack="java"
LABEL com.vibecode.sandbox.toolchains="java=21,maven=3.9.11,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN if ! getent group 1000 >/dev/null; then groupadd -g 1000 sandbox; fi \
    && if ! getent passwd 1000 >/dev/null; then useradd -u 1000 -g 1000 -m -s /bin/bash sandbox; fi \
    && for tool in java javac jar jshell; do ln -sf "/opt/java/openjdk/bin/${tool}" "/usr/local/bin/${tool}"; done \
    && mkdir -p /workspace && chown -R 1000:1000 /workspace
# The Maven base image's entrypoint writes /root/.m2 before exec; the sandbox
# runs as uid 1000, so clear it and let Maven use HOME (the runner sets /tmp).
ENTRYPOINT []
WORKDIR /workspace
USER 1000:1000

FROM golang:1.23-bookworm@sha256:167053a2bb901972bf2c1611f8f52c44d5fe7e762e5cab213708d82c421614db AS go
LABEL com.vibecode.sandbox.stack="go"
LABEL com.vibecode.sandbox.toolchains="go=1.23,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN if ! getent group 1000 >/dev/null; then groupadd -g 1000 sandbox; fi \
    && if ! getent passwd 1000 >/dev/null; then useradd -u 1000 -g 1000 -m -s /bin/bash sandbox; fi \
    && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
    && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
    && mkdir -p /workspace && chown -R 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000

FROM python:3.12-slim-bookworm@sha256:44cf1793efa7c7a476bb0f2cff81443f4a072c90c1cb127e2924933daa3e8c64 AS monorepo
LABEL com.vibecode.sandbox.stack="monorepo"
LABEL com.vibecode.sandbox.toolchains="node=24,python=3.12,java=21,maven=3.9.11,go=1.23,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
# Assemble the same pinned toolchains as the per-stack stages.
COPY --from=node /usr/local /usr/local
COPY --from=java /opt/java/openjdk /opt/java/openjdk
COPY --from=java /usr/share/maven /opt/maven
COPY --from=go /usr/local/go /usr/local/go
RUN if ! getent group 1000 >/dev/null; then groupadd -g 1000 sandbox; fi \
    && if ! getent passwd 1000 >/dev/null; then useradd -u 1000 -g 1000 -m -s /bin/bash sandbox; fi \
    && for tool in java javac jar jshell; do ln -sf "/opt/java/openjdk/bin/${tool}" "/usr/local/bin/${tool}"; done \
    && ln -sf /usr/local/go/bin/go /usr/local/bin/go \
    && ln -sf /usr/local/go/bin/gofmt /usr/local/bin/gofmt \
    && printf '#!/bin/sh\nexport JAVA_HOME=/opt/java/openjdk\nexec /opt/maven/bin/mvn "$@"\n' \
        > /usr/local/bin/mvn \
    && chmod 0755 /usr/local/bin/mvn
# pip/pytest live in a uid-1000-owned venv and are exposed on the sanitized PATH.
# The Debian pip package is deliberately not used: it is PEP 668 managed and
# rejects `pip install` as uid 1000.
RUN python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --disable-pip-version-check pytest \
    && chown -R 1000:1000 /opt/venv \
    && ln -sf /opt/venv/bin/pip /usr/local/bin/pip \
    && ln -sf /opt/venv/bin/pip3 /usr/local/bin/pip3 \
    && ln -sf /opt/venv/bin/pytest /usr/local/bin/pytest \
    && mkdir -p /workspace && chown -R 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000
