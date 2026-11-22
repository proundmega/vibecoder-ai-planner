# 01 — Requirement (fg-43)

> **Owns:** problem, goals, numbered requirements, acceptance.
> **Not here:** design (`02`), verification matrix (`03`), file operations
> (`04`), deferred table (`00`).

**Related code:** `agent/docker-compose.yml`,
`agent/docker-compose.sandbox.yml`, `agent/agent.ini.example`,
`agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java`,
`agent/host-init.sh` (new).

## Problem

fg-54 replaced container-per-agent with **one supervisor per host** that spawns
one child JVM per declared runtime. The deployment is still manual and does not
scale with the host:

- `agent/docker-compose.yml` hardcodes `2 GB / 2 CPU` for the supervisor, while
  `agent.ini` can declare any number of runtimes;
- each runtime child defaults to `768 MB` heap, and each runtime can create a
  sandbox with `2 CPU / 2 GB / 5 GB`;
- there is no capacity check, dry-run, one-command init or validation that the
  declared runtime count fits the host;
- `agent.ini` is the only source of truth for the count, so a typo can
  overcommit CPU/RAM or exhaust disk;
- nothing logs the binding constraint or the difference between declared and
  safe capacity.

On a large host this underuses the machine; on a small host it overcommits it
and triggers OOM/CPU starvation. Disk pressure then looks like code failure.

## Goals

1. Provide a one-command host deployment for the fg-54 supervisor stack.
2. Detect CPU threads, RAM and the repo volume's free space.
3. Compute a safe runtime capacity from the declared `agent.ini` sections,
   with explicit reservations.
4. Validate the declared count **before** starting the supervisor; fail closed
   when it exceeds capacity and report the binding limit.
5. Apply per-child heap, supervisor memory/CPU, sandbox CPU/RAM/disk and log
   limits from the computed values.
6. Write a reproducible `.env.agent-host` and support `--dry-run`/`--explain`.
7. Start the supervisor (and the sandbox overlay in Docker mode), wait for the
   backend `/health`, and never spawn children before enrollment/health.
8. Keep the design single-host, Docker-native and secret-free.
9. Leave a clean path to dynamic per-role autoscaling later (D6).

## Non-goals

- Kubernetes or Swarm.
- Queue-depth autoscaling (D1) or dynamic per-role autoscaling (D6).
- Multi-host scheduling (D4).
- Replacing the supervisor with a new scheduler.
- Sandbox runtime (fg-34) or storage cleanup (fg-44).
- A host-control API, admin token or `PoolManager` compatibility layer.

## Functional requirements

| ID | Requirement | Acceptance (testable) |
|---|---|---|
| FR1 | Detect host capacity: CPU threads, total RAM, free disk on the repo volume, Docker availability, the `vibecode-agent` image and the repo bind/volume. | `host-init.sh --dry-run` prints each detected value; a missing Docker/image/repo path exits non-zero with a specific message. |
| FR2 | Reserve resources for the OS, Docker, the backend and caches: `reserve_cpu = max(2, threads*0.15)`, `reserve_ram = max(8 GB, ram*0.10)`, `reserve_disk = max(100 GB, disk*0.10)`. | Unit tests cover small, reference and large hosts. |
| FR3 | Parse `agent.ini` (sections, `role`, `count`) and compute the required CPU, RAM and disk from the profile table. | A 6-worker + 1-planner file reports 13.5 CPU, 20.5 GB and 130 GB. |
| FR4 | Profiles: worker `2 CPU / 3 GB / 20 GB` (768 MB child + 2 GB sandbox + overhead), reviewer `1.5 / 2.5 / 10`, planner `1.5 / 2.5 / 10`, light `0.5 / 1.5 / 5`. | The formula uses the profile values and the declared counts. |
| FR5 | Overrides: `AGENT_RUNTIME_HEAP_MB`, `SANDBOX_CPUS`, `SANDBOX_MEMORY_MB`, `SANDBOX_DISK_MB`, `AGENT_UTILIZATION_TARGET`, `AGENT_HOST_MAX_RUNTIMES`, `SUPERVISOR_MEMORY_LIMIT`, `SUPERVISOR_CPUS`. | Each override changes the result and is printed in the summary. |
| FR6 | Compute `max_by_cpu`, `max_by_ram`, `max_by_disk`; `computed = min(...)`, capped by `AGENT_HOST_MAX_RUNTIMES`. Declared count must be `<= computed`; otherwise fail with the binding limit and the required vs available numbers. | 7 declared on a host that fits 5 exits non-zero and starts nothing. |
| FR7 | Write `.env.agent-host` atomically (umask 077) with the computed child heap, supervisor memory/CPU, sandbox limits and host metadata; `--dry-run` writes nothing. | Diff/read of the file; dry-run leaves no file. |
| FR8 | Start `docker compose -f agent/docker-compose.yml` (plus the sandbox overlay when `SANDBOX_MODE=docker`), wait for the backend `/health`, and exit non-zero on timeout without starting a partial pool. | Integration test with a fake health endpoint; timeout leaves the stack gated. |
| FR9 | Apply limits: per-child `AGENT_RUNTIME_HEAP_MB`, supervisor container `memory`/`cpus`, sandbox `SANDBOX_CPUS`/`SANDBOX_MEMORY_MB`/`SANDBOX_DISK_MB`, and Docker log rotation. | Compose config render and a container inspect in the integration test. |
| FR10 | Observability: log detected capacity, declared counts, formula inputs, computed capacity, binding limit and the under/over-utilization gap; include the same in the supervisor startup log/heartbeat. | Log assertions; a `--explain` output contains every input. |
| FR11 | Safety: never start more runtimes than the computed capacity; never overcommit memory; use 80% of free disk; fail closed on missing Docker/image/volume; no secret in output or logs. | Negative tests for each failure; grep for token-shaped output. |
| FR12 | Control: edit `agent.ini` and send `SIGHUP` to reload; stop the supervisor (or remove the section) to pause. No admin API, `POOL_ADMIN_TOKEN` or `POOL_PAUSED`. | A HUP reload test changes the declared count; no pool endpoint exists. |
| FR13 | Health gate: the supervisor must not spawn a child before the backend is healthy and the runtime declaration succeeds; host-init waits for `/health` and reports the supervisor/child status. | Fake backend down → no children, host-init exits non-zero; healthy backend → children spawn. |

## Sizing formula

```
threads      = detected CPU threads
ram_gb       = detected total RAM in GB
disk_gb      = free disk on the repo volume in GB
utilization  = AGENT_UTILIZATION_TARGET (default 0.80)

reserve_cpu  = max(2, threads * 0.15)
reserve_ram  = max(8, ram_gb * 0.10)
reserve_disk = max(100, disk_gb * 0.10)

max_by_cpu   = max(0, floor((threads * utilization - reserve_cpu) / cpu_per_runtime))
max_by_ram   = max(0, floor((ram_gb - reserve_ram) / ram_per_runtime))
max_by_disk  = max(0, floor((disk_gb * 0.80 - reserve_disk) / disk_per_runtime))
capacity     = max(0, min(max_by_cpu, max_by_ram, max_by_disk, AGENT_HOST_MAX_RUNTIMES))

declared     = sum(count for every [runtime] section)
if declared > capacity: fail closed (binding limit + numbers)
if declared < capacity: warn about under-utilization (D6 dynamic autoscaling)
```

`ram_per_runtime` and `disk_per_runtime` are weighted by the declared role mix,
not a single profile:

```
ram_required  = worker_count * 3.0 + reviewer_count * 2.5 + planner_count * 2.5 + light_count * 1.5
disk_required = worker_count * 20 + reviewer_count * 10 + planner_count * 10 + light_count * 5
cpu_required  = worker_count * 2.0 + reviewer_count * 1.5 + planner_count * 1.5 + light_count * 0.5
```

`capacity` is the maximum **total** runtime count at the declared role mix. The
formula is intentionally conservative: the sandbox is counted per active
runtime, and memory is never overcommitted.

### Example: 24 cores / 48 threads, 192 GB, 2 TB

Declared: 6 workers + 1 planner.

- reserve: 7.2 threads, 19.2 GB, 200 GB
- available CPU: `48*0.8 - 7.2 = 31.2` threads
- required CPU: `6*2 + 1*1.5 = 13.5` → fits
- available RAM: `192 - 19.2 = 172.8` GB
- required RAM: `6*3 + 1*2.5 = 20.5` → fits
- available disk: `2000*0.8 - 200 = 1400` GB
- required disk: `6*20 + 1*10 = 130` → fits

The host is CPU-bound at about 15 workers; the declared 7 uses less than half.
At `AGENT_UTILIZATION_TARGET=0.9`, available CPU rises to 36 threads and the
same host fits about 18 workers. D6 (dynamic autoscaling) is the follow-up that
would raise the counts automatically; this ticket only reports the gap and
keeps the fixed declaration.

## Deployment topology

```
host-init.sh
  -> detect CPU/RAM/disk/Docker
  -> parse agent.ini (roles + counts)
  -> compute capacity + limits
  -> write .env.agent-host
  -> docker compose up -d supervisor (+ sandbox overlay)
       -> supervisor enrolls the node and declares runtimes
       -> one child JVM per runtime (AGENT_RUNTIME_HEAP_MB)
       -> each run may create one sandbox (SANDBOX_* limits)
```

Phase 1 assumes the backend is reachable from the supervisor host. The
supervisor needs Docker only for the fg-34 sandbox; it joins the restricted
socket proxy, never the raw daemon socket.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_UTILIZATION_TARGET` | `0.80` | CPU utilization target (D6 may raise it deliberately) |
| `AGENT_HOST_MAX_RUNTIMES` | `50` | Hard cap for the computed capacity |
| `AGENT_RUNTIME_HEAP_MB` | `768` | Per-child JVM heap |
| `SUPERVISOR_MEMORY_LIMIT` | computed | Supervisor container memory limit (child heaps + overhead) |
| `SUPERVISOR_CPUS` | computed | Supervisor container CPU limit |
| `SUPERVISOR_MEMORY_BUDGET_MB` | computed | Budget the supervisor divides across children |
| `SANDBOX_CPUS` | `2.0` | Per-sandbox CPU |
| `SANDBOX_MEMORY_MB` | `2048` | Per-sandbox memory |
| `SANDBOX_DISK_MB` | `5120` | Per-sandbox disk budget |
| `AGENT_LOG_MAX_SIZE` | `10m` | Docker log rotation |
| `AGENT_LOG_MAX_FILE` | `3` | Docker log files |
| `AGENT_REPO_DIR` | repo bind root | Host path used for `df`/`du` |
| `SANDBOX_MODE` | `host` | `docker` enables the sandbox overlay |

Removed by fg-54: `MAX_POOL_SIZE`, `AGENT_POOL_SIZE`, `POOL_PAUSED`,
`POOL_ADMIN_TOKEN`, `AGENT_ROLE` as a process-wide pool role.

## Safety requirements

- Never start more runtimes than the computed capacity.
- Fail closed if Docker is unreachable, the image is missing, the repo path is
  not writable, or `agent.ini` declares more than fits.
- Memory is never overcommitted; CPU overcommit is only via an explicit
  `AGENT_UTILIZATION_TARGET > 1.0`.
- Disk target is 80% of usable space; fg-44 enforces per-runtime budgets.
- Secrets are never printed, written to `.env.agent-host`, or injected into a
  sandbox; the supervisor fetches provider keys per runtime.
- A computed capacity of 0 starts nothing and reports why.

## Acceptance criteria

1. `host-init.sh --dry-run` prints detected capacity, the parsed role mix,
   formula inputs, computed capacity and the binding limit.
2. A declared count above capacity exits non-zero, starts nothing, and names
   the binding limit and the required vs available numbers.
3. A valid declaration writes `.env.agent-host` and starts the supervisor; the
   backend health gate holds children until `/health` is green.
4. The reference host (24c/48t, 192 GB, 2 TB, 6 workers + 1 planner) fits and
   reports the unused capacity.
5. Overrides change the result and are logged.
6. The supervisor container, child heaps and sandbox limits match the computed
   values; log rotation is configured.
7. `SIGHUP` reloads a changed `agent.ini`; stopping the supervisor pauses work.
8. No `PoolManager`/`POOL_ADMIN_TOKEN`/`MAX_POOL_SIZE` path remains.
9. No secret appears in output, `.env.agent-host` or logs.

## Out of scope

- Queue-depth autoscaling (D1) and dynamic per-role autoscaling (D6).
- Multi-host scheduling (D4).
- Storage cleanup/idle refresh (fg-44).
- Sandbox runtime internals (fg-34).
- systemd units (D7) and Docker Desktop (D8).

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
