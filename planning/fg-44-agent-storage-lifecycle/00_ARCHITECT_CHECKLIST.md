# 00_ARCHITECT_CHECKLIST.md - Agent Storage Lifecycle and Idle Refresh (fg-44)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-43 Docker deployment, fg-33 durable execution
**Related code:** `backend/src/services/PoolManager.js`, `WorkspaceManager`, `agent/Dockerfile`

## Why this ticket exists

Agent containers are long-running and share a `vibecode_repos` volume. Repo clones, `node_modules`, Maven/npm caches, OpenCode temp files, Docker logs and images accumulate. A busy host can fill the 2 TB SSD or exhaust inodes even if CPU/RAM are fine.

## Checklist

- [ ] Measure current disk/inode growth per agent and per ticket
- [ ] Define per-agent workspace layout and TTL
- [ ] Add cleanup on ticket end, container stop and idle
- [ ] Define the 2-hour idle refresh policy and identity handling
- [ ] Add disk watermarks (warn/stop-spawn/cleanup/emergency)
- [ ] Add Docker log rotation and image cleanup
- [ ] Protect active tickets/leases from cleanup
- [ ] Add orphan workspace reaper and metrics
- [ ] Add tests for cleanup, refresh, watermarks and active-ticket safety
- [ ] Document manual recovery when the disk is full
