# 00_ARCHITECT_CHECKLIST.md - Agent Docker Deployment and Host Sizing (fg-43)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-33 durable execution, fg-34 sandbox (recommended)
**Related code:** `agent/docker-compose.yml`, `backend/src/services/PoolManager.js`

## Why this ticket exists

The current deployment is a single `agent` Compose service plus a `PoolManager` that creates containers through the Docker API. On a large host (for example 24 cores / 48 threads, 192 GB RAM, 2 TB SSD) the pool size is a manual constant (`MAX_POOL_SIZE=50`) and the container limits are hardcoded (2 GB RAM, no CPU limit). There is no host-sizing heuristic and no one-command deployment.

## Checklist

- [ ] Define the host capacity model and reservation policy
- [ ] Write the sizing formula and examples for build/review/light agents
- [ ] Create `agent/host-init.sh` with `--dry-run` and `--yes`
- [ ] Generate a `.env.agent-host` consumed by Compose/PoolManager
- [ ] Add per-container CPU/RAM/PID/log limits
- [ ] Define role profiles (build, review, fixer, light poller)
- [ ] Decide the single-host topology (backend + PoolManager + agents on one Docker host)
- [ ] Add compose deployment file and health checks
- [ ] Add validation, logging and override behavior
- [ ] Document multi-host/remote-Docker as a follow-up
- [ ] Keep Kubernetes out of scope for this ticket
