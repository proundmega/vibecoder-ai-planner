# 00_ARCHITECT_CHECKLIST.md - Harness Sandbox and Supply-Chain Security (fg-34)

**Status:** Planned - not implemented
**Date:** 2026-10-31
**Depends on:** fg-30 Phase 1 (OpenCode harness supervisor)
**Related code:** `OpenCodeClient`, `HarnessTicketProcessor`, `agent/Dockerfile`

## Why this ticket exists

Phase 1 runs OpenCode with `bash` access in a cloned repo on the agent container. Config deny-lists and prompt rules are not isolation: repo code, build scripts, tests and `npm install` lifecycle scripts can execute arbitrary code, reach the network, or read whatever the agent container can read.

## Checklist

- [ ] Choose the sandbox runtime (Docker sibling, Podman, rootless container, microVM)
- [ ] Define CPU/memory/PID/disk/time limits per run
- [ ] Deny host Docker socket, privileged mode and host mounts
- [ ] Define the network egress policy (model endpoints + package registries only)
- [ ] Define secretless execution and a safe way to inject non-secret test config
- [ ] Harden prompt-injection handling for repo docs, issues and PR text
- [ ] Add malicious-repo and escape-attempt tests
- [ ] Add image scanning, SBOM and signed base images
- [ ] Define the fallback for local Windows development
- [ ] Roll out behind a flag before making it the default
