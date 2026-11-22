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
depends_on: ["fg-33", "fg-34", "fg-54"]
---

# 00 — Agent Docker Deployment and Host Sizing (fg-43)

> **Owns:** status, ticket map, deferred scope, user decisions.
> **Not here:** requirements (`01`), design (`02`), verification matrix (`03`),
> file operations (`04`).

**Related code:** `agent/docker-compose.yml`,
`agent/docker-compose.sandbox.yml`, `agent/agent.ini.example`,
`agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java`,
`agent/host-init.sh` (new).

## Relationship to fg-54 (implemented)

fg-54 replaced the container-per-agent pool with **one supervisor per host**
that spawns one child JVM per declared runtime. `PoolManager` and its container
creation path no longer exist. The unit this ticket sizes is therefore:

- the **supervisor container** (JVM + child processes),
- each **runtime child JVM** (`AGENT_RUNTIME_HEAP_MB`),
- each **sandbox container** a runtime may create (`SANDBOX_CPUS`,
  `SANDBOX_MEMORY_MB`, `SANDBOX_DISK_MB`),
- the **repo volume** shared by the runtimes.

The sizing formula is unchanged; the profile names now match the fg-54 roles
(`worker`, `reviewer`, `planner`) plus a `light` poller variant.

## Why this ticket exists

The current Compose stack hardcodes `2 GB / 2 CPU` for the supervisor and
`768 MB` per child, while `agent.ini` can declare any number of runtimes and
each runtime can create a 2 CPU / 2 GB sandbox. On a large host (for example
24 cores / 48 threads, 192 GB RAM, 2 TB SSD) this either underuses the machine
or overcommits it; on a small host it starts more runtimes than the machine can
hold. There is no dry-run, no capacity check, no one-command deployment and no
validation that the declared runtime count fits.

## Decisions needed from the user

| # | Decision | Options | Recommendation | Answer |
|---|---|---|---|---|
| 1 | Sizing unit | supervisor runtime children / keep PoolManager containers | Supervisor-only; remove PoolManager from this ticket | Answered 2026-11-22: supervisor-only |
| 2 | Per-runtime profiles | modern defaults / legacy numbers / custom | worker 2 CPU / 3 GB / 20 GB, reviewer 1.5 / 2.5 / 10, planner 1.5 / 2.5 / 10, light 0.5 / 1.5 / 5 | Answered 2026-11-22: modern defaults |
| 3 | Runtime-count control after init | admin API / `agent.ini` + SIGHUP / both | `agent.ini` + SIGHUP; no new secret or endpoint | Answered 2026-11-22: no admin API |
| 4 | Disk target | 80% / 70% / custom | 80% of the repo volume, reserve 10% (min 100 GB) | Answered 2026-11-22: 80% |
| 5 | Non-Linux / Docker Desktop | fail closed / best effort | Fail closed with a clear message; Linux Docker only | Assumed; revisit if a Mac host is required |
| 6 | Dynamic per-role autoscaling | fixed counts / compute counts on the fly | Fixed counts now; record dynamic autoscaling as D6 | Answered 2026-11-22: fixed now, D6 later |

## Deferred register (canonical)

Every deliberate omission and follow-up lives here exactly once. Status and
deferred scope are owned by this document; `01`–`04` link here.

| ID | Item | Source | Category | Follow-up | State |
|---|---|---|---|---|---|
| D1 | Queue-based autoscaling | fg-30 | Infrastructure | fg-38 follow-up | open |
| D2 | Durable leases across restarts | fg-33 | Reliability | fg-33-durable-harness-execution | done (#110) |
| D3 | Sandboxed agent containers | fg-34 | Security | fg-34-harness-sandbox | done (fg-34 slices) |
| D4 | Multi-host/multi-agent orchestration | fg-40 | Agent | fg-40-multi-agent-orchestration | open |
| D5 | Storage lifecycle and idle refresh | fg-44 | Infrastructure | fg-44-agent-storage-lifecycle | open |
| D6 | Dynamic per-role autoscaling: compute the runtime counts from the declared roles and `AGENT_UTILIZATION_TARGET` instead of fixed profiles. Example: 24 cores / 48 threads, 6 workers, 1 planner, 90% utilization; use the remaining capacity for more workers or a larger planner share. | self | Infrastructure | new ticket after the pilot | open |
| D7 | systemd unit as an alternative to Compose | self | Operations | follow-up | open |
| D8 | Docker Desktop / non-Linux host support | self | Compatibility | follow-up | open |
