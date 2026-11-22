---
id: "fg-43"
title: "Agent Docker Deployment and Host Sizing"
status: in_review
priority: "P1"
effort: "Large"
scope: "Backend"
created: "2026-10-31"
updated: "2026-11-22"
pr: 197
branch: "feat/fg-43-host-sizing"
depends_on: ["fg-33", "fg-54"]
---

# 00 — Agent Docker Deployment and Host Sizing (fg-43)

## Status evidence

| Claim | Evidence | Checked |
|---|---|---|
| Implementation in review | PR #197; see `03` Results | ☑ |
| Verification results | `03` → Results (shell 65/65; Java 41 focused / full agent suite 929 tests; Compose base+sandbox) | ☑ |

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`), file operations (`04`).

**Related code:** `agent/scripts/host-init.sh`, `agent/scripts/host-init.test.sh`,
`agent/docker-compose.yml`, `agent/agent.ini.example`,
`agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java`.

## Relationship to fg-54 (merged)

`fg-54` replaced the container-per-agent pool with **one supervisor per host**
that spawns one child JVM per declared runtime. This ticket sizes that
declaration, enforces the host budget and starts the supervisor Compose stack.
There is no `PoolManager`, `POOL_ADMIN_TOKEN`, `MAX_POOL_SIZE` or admin pool
API in the current model (`fg-54` D9 removed the pool controller).

Sandboxed agent containers remain fg-34's scope (D3). fg-34 hardening is
recommended for a production host but is not a hard dependency of this ticket.

## Why this ticket exists

The current deployment is a single `agent` Compose service plus a `PoolManager` that creates containers through the Docker API. On a large host (for example 24 cores / 48 threads, 192 GB RAM, 2 TB SSD) the pool size is a manual constant (`MAX_POOL_SIZE=50`) and the container limits are hardcoded (2 GB RAM, no CPU limit). There is no host-sizing heuristic and no one-command deployment.

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Queue-based autoscaling and dynamic per-role counts: compute worker/reviewer/planner/light counts from `AGENT_UTILIZATION_TARGET` and remaining capacity instead of fixed `agent.ini` counts (e.g. 48 threads, 6 workers + 1 planner at 90%, then fill spare capacity). | fg-30/self | Infrastructure | fg-38-harness-budgets-routing follow-up or a dedicated autoscaling ticket | open |
| D2 | Durable leases across restarts | fg-33 | Reliability | fg-33-durable-harness-execution | open |
| D3 | Sandboxed agent containers | fg-34 | Security | fg-34-harness-sandbox | open |
| D4 | Multi-host/multi-agent orchestration | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D5 | Storage lifecycle and idle refresh | fg-44 | Infrastructure | fg-44-agent-storage-lifecycle | open |
| D6 | Per-child cgroups and PID limits | self | Security | fg-34/supervisor follow-up | open |
| D7 | Backend `/health` startup gate | self | Reliability | separate supervisor/lifecycle ticket | open |
