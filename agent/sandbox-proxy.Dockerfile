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
# Pin the base image by digest before production (fg-34 FR9).
FROM node:24-alpine

WORKDIR /opt/vibecode
USER 1000:1000
