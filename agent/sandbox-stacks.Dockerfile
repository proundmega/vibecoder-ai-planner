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
# The monorepo stage is the fallback for repositories that detect more than
# one language. Its distro toolchains are pinned by the base digest; the exact
# Debian package versions are recorded in the image labels.

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
LABEL com.vibecode.sandbox.toolchains="python=3.12,pip,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
    && rm -rf /var/lib/apt/lists/*
RUN if ! getent group 1000 >/dev/null; then groupadd -g 1000 sandbox; fi \
    && if ! getent passwd 1000 >/dev/null; then useradd -u 1000 -g 1000 -m -s /bin/bash sandbox; fi \
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
    && mkdir -p /workspace && chown -R 1000:1000 /workspace
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
    && mkdir -p /workspace && chown -R 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000

FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530 AS monorepo
LABEL com.vibecode.sandbox.stack="monorepo"
LABEL com.vibecode.sandbox.toolchains="node=24,python3=3.11,java=17,go=1.19,maven=3.8,git,ripgrep"
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git bash ripgrep curl jq ca-certificates build-essential \
        python3 python3-pip python3-venv openjdk-17-jdk maven golang-go \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /workspace && chown -R 1000:1000 /workspace
WORKDIR /workspace
USER 1000:1000
