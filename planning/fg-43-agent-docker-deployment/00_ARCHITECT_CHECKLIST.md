---
id: "fg-43"
title: "Agent Docker Deployment and Host Sizing"
status: planned
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-03"
pr: null
branch: null
depends_on: ["fg-33", "fg-34"]
---

# 00 — Agent Docker Deployment and Host Sizing (fg-43)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `agent/docker-compose.yml`, `backend/src/services/PoolManager.js`

## Why this ticket exists

The current deployment is a single `agent` Compose service plus a `PoolManager` that creates containers through the Docker API. On a large host (for example 24 cores / 48 threads, 192 GB RAM, 2 TB SSD) the pool size is a manual constant (`MAX_POOL_SIZE=50`) and the container limits are hardcoded (2 GB RAM, no CPU limit). There is no host-sizing heuristic and no one-command deployment.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Queue-based autoscaling | fg-30 | Infrastructure | fg-38-harness-budgets-routing follow-up | open |
| D2 | Durable leases across restarts | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D3 | Sandboxed agent containers | fg-34 | Security | fg-34-harness-sandbox | open |
| D4 | Multi-host/multi-agent orchestration | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D5 | Storage lifecycle and idle refresh | fg-44 | Infrastructure | fg-44-agent-storage-lifecycle | open |
