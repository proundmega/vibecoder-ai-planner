---
id: "fg-43"
title: "Agent Docker Deployment and Host Sizing"
status: planned
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-22"
pr: null
branch: null
depends_on: ["fg-33", "fg-54"]
---

# 00 — Agent Docker Deployment and Host Sizing (fg-43)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `agent/docker-compose.yml`, `backend/src/services/PoolManager.js`

## Relationship to fg-54 (merged)

`fg-54` replaces the container-per-agent pool with a **supervisor** that runs
runtimes in one host stack. This ticket keeps the host sizing, reservations,
limits, pause controls and health gates; the unit being sized becomes a
**runtime child process**, and the pool size becomes the declared runtime count.
`PoolManager` container creation is superseded (`fg-54` D9). Role profiles map
to the fg-54 enum (`worker`, `reviewer`, `planner`); the "fixer" and "light
poller" profiles become worker/planner variants.

`01` FR4, FR7 and FR9 are read with this replacement; the sizing formula and
safety rules are unchanged.

Sandboxed agent containers remain fg-34's scope (D3). fg-34 hardening is
recommended for a production host but is not a hard dependency of this ticket.

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
