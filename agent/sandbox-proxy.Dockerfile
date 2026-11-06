# Trusted egress allowlist proxy for fg-34 sandboxes.
#
# The supervisor injects the proxy script inline, so this image only needs
# Node. Keeping it separate from SANDBOX_IMAGE means a repo-specific sandbox
# image (fg-39 / D3) cannot change the proxy implementation or inherit test
# environment variables into it.
#
# Build:
#   docker build -f agent/sandbox-proxy.Dockerfile -t vibecode-sandbox-proxy:latest agent
#
# Base image is pinned by digest (fg-34 FR9). Update the digest deliberately
# when upgrading; run `agent/scripts/sandbox-image-security.sh --check-pins`.
FROM node:24-alpine@sha256:a34ab6d7f6f4813f4d0c5469d74685604b962fbdbf5793a7bc7b4998ecb867c8

WORKDIR /opt/vibecode
USER 1000:1000
