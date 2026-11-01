# 01_ARCHITECT_REQUIREMENT.md - Agent Docker Deployment and Host Sizing (fg-43)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-33 durable execution; fg-34 sandbox recommended
**Related code:** `agent/docker-compose.yml`, `backend/src/services/PoolManager.js`

## Problem

The agent deployment is manual and does not scale with the host:

- `agent/docker-compose.yml` runs one agent with 2 GB / 2 CPU;
- `PoolManager` creates containers with a hardcoded 2 GB memory limit and no CPU limit;
- pool size is a fixed `MAX_POOL_SIZE` (default 50) unrelated to host capacity;
- the pool shares one `vibecode_repos` volume across all agents;
- there is no init script, capacity check, dry-run or health validation;
- agents are all treated as the same workload even though build, review and fixer roles have very different footprints.

On a beefy host this either underuses the machine or overcommits it and triggers OOM/CPU starvation.

## Goals

1. Provide a one-command host deployment for the Docker agent pool.
2. Compute a safe pool size from CPU, RAM and disk, with explicit reservations.
3. Support override values and a dry-run that prints the calculation.
4. Apply per-container CPU, memory, PID and log limits.
5. Support role profiles (build, review, fixer, light poller).
6. Keep the design single-host and Docker-native.
7. Make the calculation observable and reproducible.
8. Leave a clean path to a remote/multi-host pool controller later.

## Non-goals

- Kubernetes or Swarm.
- Autoscaling based on queue depth (later, with the durable queue).
- Multi-host scheduling in this ticket.
- Replacing `PoolManager` with a new scheduler.
- Sandboxing (fg-34) or storage lifecycle (fg-44).

## Functional requirements

- **FR1 - Detect host capacity:** CPU cores/threads, total RAM, free disk on the repo volume, Docker availability and existing containers.
- **FR2 - Reservations:** reserve CPU, RAM and disk for the OS, Docker, the backend/pool controller and caches.
- **FR3 - Sizing formula:** compute max agents by CPU, RAM and disk; take the minimum; clamp to `[0, AGENT_MAX_POOL_SIZE]`. A result of 0 means no agent fits: write 0, keep the pool paused, and report why.
- **FR4 - Profiles:** build = 2 CPU / 4 GB / 20 GB workspace; review = 1 CPU / 2 GB / 10 GB; fixer = 2 CPU / 4 GB / 15 GB; light poller = 0.5 CPU / 1 GB / 5 GB.
- **FR5 - Overrides:** `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT`, `AGENT_DISK_BUDGET_GB`, `AGENT_POOL_SIZE` (0 allowed), `AGENT_MAX_POOL_SIZE`, `AGENT_ROLE`, `AGENT_UTILIZATION_TARGET`, `POOL_PAUSED`.
- **FR6 - Output:** write `.env.agent-host` with the computed values and print a summary; `--dry-run` prints without writing.
- **FR7 - Deploy:** `docker compose -f agent/docker-compose.host.yml up -d` (or the existing planner compose with the computed env).
- **FR8 - Validate:** fail if Docker is unavailable, the image is missing or the volume does not exist. If the backend is already running, validate it first; otherwise start Compose, wait for `/health`, and only then enable the pool (see the init ordering below).
- **FR9 - Limits:** PoolManager sets `NanoCpus`, `Memory`, `PidsLimit`, log rotation and labels from the computed values.
- **FR10 - Observability:** log the calculation inputs/outputs and expose pool size/host capacity in status/heartbeat.
- **FR11 - Safety:** never exceed host capacity; memory is not overcommitted; disk target is 80% of usable space; hard cap remains. A computed pool of 0, `AGENT_POOL_SIZE=0`, `MAX_POOL_SIZE=0` or `POOL_PAUSED=true` must stop spawning, not start one agent.
- **FR12 - Runtime pool control:** expose an admin endpoint to set `{ paused, maxPoolSize }` so host-init and recovery can pause/resume without a restart; `requestAgent` honors it immediately.

## Sizing formula

```
reserve_cpu   = max(2, threads * 0.15)
reserve_ram   = max(8 GB, ram_gb * 0.10)
reserve_disk  = max(100 GB, disk_gb * 0.10)

max_by_cpu  = floor((threads * utilization - reserve_cpu) / cpu_per_agent)
max_by_ram  = floor((ram_gb - reserve_ram) / ram_per_agent)
max_by_disk = floor((disk_gb * 0.80 - reserve_disk) / disk_per_agent)

max_by_cpu  = max(0, max_by_cpu)
max_by_ram  = max(0, max_by_ram)
max_by_disk = max(0, max_by_disk)

pool = min(max_by_cpu, max_by_ram, max_by_disk, AGENT_MAX_POOL_SIZE)
if AGENT_POOL_SIZE is set:
  pool = min(AGENT_POOL_SIZE, AGENT_MAX_POOL_SIZE)
pool = max(0, pool)   # 0 is valid: no capacity, stay paused
```

`utilization` defaults to `0.80`; CPU may be overcommitted only with an explicit opt-in. Memory is never overcommitted.

Variable mapping:

- `AGENT_MAX_POOL_SIZE` is the hard cap for the formula.
- `AGENT_POOL_SIZE` is an explicit override, clamped to `[0, AGENT_MAX_POOL_SIZE]`.
- The final value is written to `MAX_POOL_SIZE`, which is what `PoolManager` reads at runtime.
- `POOL_PAUSED=true` (or `MAX_POOL_SIZE=0`) stops new assignments independently of the formula.

### Example: 24 cores / 48 threads, 192 GB, 2 TB

Build profile (2 CPU, 4 GB, 20 GB):

- reserve: 7.2 threads, 19.2 GB, 200 GB
- CPU: `(48*0.8 - 7.2)/2` = 15
- RAM: `(192 - 19.2)/4` = 43
- disk: `(2000*0.8 - 200)/20` = 70
- **pool = 15** (CPU-bound)

Light profile (0.5 CPU, 1 GB, 5 GB):

- CPU: 76, RAM: 172, disk: 280 → **pool = min(AGENT_MAX_POOL_SIZE)** (usually the cap)

This shows the important point: with active build agents the host is CPU-bound, not RAM-bound.

## Deployment topology

Phase 1 assumes the planner backend (`PoolManager`) runs on the same Docker host as the agents, so it can use the Docker socket. The init script configures that backend and ensures the agent image/volume are present.

If the backend runs elsewhere, the pool controller must talk to the agent host through a secured Docker API or a small dedicated controller. That is a follow-up, not part of this ticket.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_ROLE` | `build` | build/review/fixer/light |
| `AGENT_CPU_LIMIT` | profile | Per-agent CPU (e.g. `2.0`) |
| `AGENT_MEMORY_LIMIT` | profile | Per-agent memory (e.g. `4g`) |
| `AGENT_DISK_BUDGET_GB` | profile | Workspace budget per agent |
| `AGENT_POOL_SIZE` | unset | Explicit override, clamped to `[0, AGENT_MAX_POOL_SIZE]`; `0` pauses |
| `AGENT_UTILIZATION_TARGET` | `0.80` | CPU utilization target |
| `AGENT_RESERVED_CPU` | computed | CPU reserved for host/backend |
| `AGENT_RESERVED_MEMORY_GB` | computed | RAM reserved |
| `AGENT_RESERVED_DISK_GB` | computed | Disk reserved |
| `AGENT_MAX_POOL_SIZE` | `50` | Hard cap for the formula |
| `MAX_POOL_SIZE` | computed | Runtime value read by `PoolManager`; host-init writes the computed/overridden pool |
| `POOL_PAUSED` | `false` | Explicit pause flag; `MAX_POOL_SIZE=0` also pauses |
| `AGENT_REPO_DIR` | volume mountpoint | Host path used for `df`/`du`; resolve with `docker volume inspect` if unset |
| `AGENT_PIDS_LIMIT` | `512` | Per-container PID limit |
| `AGENT_LOG_MAX_SIZE` | `10m` | Docker log rotation |
| `AGENT_LOG_MAX_FILE` | `3` | Docker log files |

## Safety requirements

- Never start more agents than the computed limit.
- Fail closed if Docker is unreachable or the agent image is missing.
- Do not silently fall back to host execution.
- Memory limits are enforced; CPU limits are enforced with `NanoCpus`.
- Disk budgeting is enforced by fg-44; this ticket only computes the budget.
- Secrets stay in the environment/secret store; the init script never prints keys.

## Acceptance criteria

1. `agent/host-init.sh --dry-run` prints detected capacity, profile, formula inputs and computed pool size.
2. Running without `--dry-run` writes `.env.agent-host`, starts the stack, waits for `/health`, then enables the pool; if health never passes, it leaves the pool paused and exits non-zero.
3. On the reference host, the build profile computes a safe pool (about 15) and the light profile respects the hard cap.
4. Overrides change the result and are reflected in logs.
5. Containers are created with CPU/RAM/PID/log limits.
6. The script fails clearly if Docker, the image or the volume is missing; a not-yet-started backend is started first rather than treated as a failure.
7. The calculated pool and host capacity are visible in status/logs.
8. No secret appears in the script output or logs.
9. No capacity (all maxima 0) writes `MAX_POOL_SIZE=0`, logs the binding limit, and starts no agents.
10. `POOL_PAUSED=true`, `MAX_POOL_SIZE=0`, or the admin config endpoint pauses/resumes the pool at runtime, and `PoolManager` honors it immediately.

## Out of scope

- Kubernetes/Minikube.
- Autoscaling on queue depth.
- Multi-host scheduling.
- Storage cleanup/idle refresh (fg-44).
- Sandbox runtime (fg-34).

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-30 | Queue-based autoscaling | Infrastructure | `fg-38-harness-budgets-routing` follow-up | No |
| 2 | fg-33 | Lease-aware pool controller | Reliability | `fg-33-durable-harness-execution` | No |
| 3 | fg-34 | Sandboxed agent containers | Security | `fg-34-harness-sandbox` | No |
| 4 | fg-44 | Storage lifecycle and idle refresh | Infrastructure | `fg-44-agent-storage-lifecycle` | No |
| 5 | fg-40 | Multi-host/multi-agent orchestration | Agent | `fg-40-multi-agent-orchestration` | No |
