# 01_ARCHITECT_REQUIREMENT.md - Agent Docker Deployment and Host Sizing (fg-43)

**Related code:** `agent/scripts/host-init.sh`, `agent/docker-compose.yml`,
`agent/agent.ini.example`, `agent/src/main/java/com/vibecode/agent/supervisor/`.

**Scope update (2026-11-22):** fg-54 removed `PoolManager` and the
container-per-agent model. The live deployment is one supervisor per host with
one child JVM per declared runtime. `POOL_ADMIN_TOKEN`, `MAX_POOL_SIZE` and the
pool admin endpoint are **not** part of this ticket; the equivalent control is
the `AGENT_HOST_MAX_RUNTIMES` guard plus `host-init.sh`.

## Problem

The fg-54 supervisor deployment is manual and can overcommit the host:

- `agent/docker-compose.yml` hardcodes 2 GB / 2 CPU for the supervisor;
- `agent.ini` can declare any number of runtime children without checking the
  host;
- there is no init script, capacity check, dry-run or generated env file;
- worker, reviewer and planner children have different footprints but are
  treated as one workload;
- a later count increase can silently start more children than the host fits.

On a beefy host this either underuses the machine or overcommits it and
triggers OOM/CPU starvation.

## Goals

1. Provide a one-command host deployment for the supervisor.
2. Sum the declared role/count profiles and check CPU, RAM and disk with
   explicit reservations.
3. Support override values and a dry-run/explain mode that prints the
   calculation.
4. Apply supervisor container CPU, memory and log limits from the generated env.
5. Support the fg-54 role profiles (`worker`, `reviewer`, `planner`).
6. Keep the design single-host and Docker-native.
7. Make the calculation observable and reproducible.
8. Guard against a later `agent.ini` growth beyond the sized declaration.

## Non-goals

- Kubernetes or Swarm.
- Autoscaling based on queue depth (later, with the durable queue).
- Multi-host scheduling in this ticket.
- Sandboxing (fg-34) or storage lifecycle (fg-44).
- A pool controller/admin API (removed by fg-54).

## Functional requirements

- **FR1 - Detect host capacity:** CPU cores/threads, total RAM, free disk on the repo volume, Docker availability and existing containers.
- **FR2 - Reservations:** reserve CPU, RAM and disk for the OS, Docker, the supervisor JVM and caches.
- **FR3 - Capacity check:** sum the declared profiles and compare with available CPU, RAM and disk after reservations. A declaration that exceeds any dimension fails closed with the binding constraint; no value is written and no agent starts.
- **FR4 - Profiles:** worker = 2 CPU / 4 GB / 20 GB workspace; reviewer = 1 CPU / 2 GB / 10 GB; planner = 1 CPU / 2 GB / 10 GB. Profiles size fg-54 runtime children, not containers.
- **FR5 - Overrides:** `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT`, `AGENT_DISK_BUDGET_GB`, `AGENT_UTILIZATION_TARGET`, `AGENT_RESERVED_CPU`, `AGENT_RESERVED_MEMORY_GB`, `AGENT_RESERVED_DISK_GB`, `AGENT_SUPERVISOR_OVERHEAD_MB`, `AGENT_RUNTIME_HEAP_MB`, `AGENT_LOG_MAX_SIZE`, `AGENT_LOG_MAX_FILE`. There is no `AGENT_MAX_POOL_SIZE`, `AGENT_POOL_SIZE` or `MAX_POOL_SIZE`.
- **FR6 - Output:** write `.env.agent-host` (mode `0600`) with the computed values and print a summary; `--dry-run`/`--check` write nothing; `--force` replaces an existing file.
- **FR7 - Deploy:** `docker compose --env-file .env.agent-host -f agent/docker-compose.yml up -d` with the computed env (one supervisor stack; fg-54 supersedes the container-per-agent deployment).
- **FR8 - Validate:** fail if Docker is unavailable for `--yes`, the declaration is missing, or a capacity dimension does not fit; dry-run/check work without a daemon.
- **FR9 - Limits:** Compose applies `SUPERVISOR_MEMORY_LIMIT`, `SUPERVISOR_CPUS` and Docker log rotation from the generated env. The supervisor applies the child heap (`AGENT_RUNTIME_HEAP_MB`) and shared memory budget; per-child cgroups remain a follow-up.
- **FR10 - Observability:** log the detected capacity, reserves, required totals, computed container limits and binding dimension; the supervisor logs declared slots vs the host cap.
- **FR11 - Safety:** never exceed host capacity; memory is not overcommitted; disk uses 80% of free space; a failed check writes nothing and starts nothing.
- **FR12 - Runtime guard:** `AGENT_HOST_MAX_RUNTIMES` is written from the declared slot count; the supervisor refuses to start when `agent.ini` grows beyond it. `0` disables the guard for a hand-managed host.
- **FR13 - Restart behavior:** Compose restarts the supervisor and `agent.ini` remains the desired state; a count change requires re-running `host-init.sh`. A backend health gate is not part of this ticket.

## Sizing formula

```
required_cpu  = sum(count * profile_cpu(role))
required_ram  = sum(count * profile_ram(role))
required_disk = sum(count * profile_disk(role))

reserve_cpu   = max(2, threads * 0.15)
reserve_ram   = max(8 GB, ram_gb * 0.10)
reserve_disk  = max(100 GB, disk_gb * 0.10)

available_cpu  = threads * utilization - reserve_cpu
available_ram  = ram_gb - reserve_ram
available_disk = disk_gb * 0.80 - reserve_disk
```

The declaration fits only when:

```
required_cpu  <= available_cpu
required_ram + supervisor_overhead <= available_ram
required_disk <= available_disk
```

`utilization` defaults to `0.80`. Memory is never overcommitted. On failure the
script exits non-zero, writes nothing and starts nothing.

Variable mapping:

- `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT`, `AGENT_DISK_BUDGET_GB` override the
  role profile globally.
- `AGENT_HOST_MAX_RUNTIMES` is the declared slot count; the supervisor refuses
  a larger `agent.ini`.
- `SUPERVISOR_CPUS` and `SUPERVISOR_MEMORY_LIMIT` are the Compose container
  limits for the summed declaration plus supervisor overhead.

### Example: 24 cores / 48 threads, 192 GB, 2 TB

Reference declaration: 3 workers + 2 reviewers + 2 planners = **7 runtimes**:

- required: CPU 10, RAM 20 GB, disk 100 GB
- reserve: 7.2 threads, 19.2 GB, 200 GB
- available: CPU 31.2, RAM 172.8 GB, disk 1400 GB
- **fits**; writes `AGENT_HOST_MAX_RUNTIMES=7`, `SUPERVISOR_CPUS=10.00`,
  `SUPERVISOR_MEMORY_LIMIT=21G` (20 GB + 512 MB overhead, rounded up)

A 7-worker declaration (14 CPU / 28 GB / 140 GB) still fits this host; a
declaration that pushes past one of the three dimensions fails closed instead
of starting a partial fleet.

## Deployment topology

The supervisor runs on the Docker host, whether the planner backend is local or
remote. `host-init.sh` writes `.env.agent-host` and the Compose file starts one
supervisor per host. There is no separate pool controller or multi-host
scheduler in this ticket.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_INI_PATH` | `<repo>/agent.ini` | Supervisor declaration parsed by host-init |
| `AGENT_HOST_ENV_FILE` | `<repo>/.env.agent-host` | Generated env file (mode `0600`) |
| `AGENT_CPU_LIMIT` | role profile | Per-runtime CPU override |
| `AGENT_MEMORY_LIMIT` | role profile | Per-runtime memory override (e.g. `4g`) |
| `AGENT_DISK_BUDGET_GB` | role profile | Workspace budget per runtime |
| `AGENT_UTILIZATION_TARGET` | `0.80` | CPU utilization target |
| `AGENT_RESERVED_CPU` | computed | CPU reserved for host/backend |
| `AGENT_RESERVED_MEMORY_GB` | computed | RAM reserved |
| `AGENT_RESERVED_DISK_GB` | computed | Disk reserved |
| `AGENT_SUPERVISOR_OVERHEAD_MB` | `512` | Supervisor/container overhead |
| `AGENT_RUNTIME_HEAP_MB` | `768` | Child JVM heap |
| `AGENT_LOG_MAX_SIZE` | `10m` | Docker log rotation |
| `AGENT_LOG_MAX_FILE` | `3` | Docker log files |
| `AGENT_HOST_MAX_RUNTIMES` | declared slots | Supervisor startup guard; `0` disables |
| `SUPERVISOR_CPUS` | required CPU | Compose CPU limit |
| `SUPERVISOR_MEMORY_LIMIT` | required RAM + overhead | Compose memory limit |
| `AGENT_REPO_DIR` | volume mountpoint | Host path used for `df` |

## Safety requirements

- Never start a declaration larger than the computed capacity.
- Fail closed before writing `.env.agent-host` or starting Compose.
- Do not silently fall back to host execution.
- Memory is never overcommitted; CPU uses the utilization target.
- Disk budgeting is enforced by fg-44; this ticket computes the budget.
- Secrets stay in the environment/secret store; the init script never prints
  keys and the generated file contains only sizing/logging values.

## Acceptance criteria

1. `agent/scripts/host-init.sh --dry-run --explain` prints detected capacity,
   role totals, reserves, formula inputs and the computed limits.
2. Running without `--dry-run` writes `.env.agent-host` (mode `0600`) and prints
   the ready-to-run Compose command; `--yes` starts the stack.
3. On the reference host, 7 runtimes fit and the script writes
   `AGENT_HOST_MAX_RUNTIMES=7`.
4. Over-capacity declarations fail with the binding dimension and write nothing.
5. `--check` validates without writing; `--force` is required to replace an
   existing env file; dry-run/check work without Docker.
6. `docker compose -f agent/docker-compose.yml config` and the sandbox overlay
   render with the generated limits and log rotation.
7. The supervisor refuses a declaration larger than `AGENT_HOST_MAX_RUNTIMES`.
8. No secret appears in the script output or `.env.agent-host`.

## Out of scope

- Kubernetes/Minikube.
- Autoscaling on queue depth.
- Multi-host scheduling.
- Storage cleanup/idle refresh (fg-44).
- Sandbox runtime (fg-34).

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not keep a copy.
