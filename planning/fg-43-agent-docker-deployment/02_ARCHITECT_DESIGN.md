# 02 — Design (fg-43)

> **Owns:** current-state audit, design, data flow, contracts, risks, rollout.
> **Not here:** requirements (`01`), verification matrix (`03`), file operations
> (`04`), status and deferrals (`00`).

## Current State

- `agent/docker-compose.yml` runs one `supervisor` with a hardcoded `2G / 2.0`
  container limit; `AGENT_RUNTIME_HEAP_MB` defaults to `768` and
  `SUPERVISOR_MEMORY_BUDGET_MB` to `0` (per-child heap).
- `agent.ini` declares one or more `[runtime]` sections with `count`; nothing
  checks the total against the host.
- Each runtime may create a sandbox with `SANDBOX_CPUS=2.0`,
  `SANDBOX_MEMORY_MB=2048`, `SANDBOX_DISK_MB=5120`.
- `PoolManager`, `MAX_POOL_SIZE`, `POOL_PAUSED` and `POOL_ADMIN_TOKEN` no
  longer exist after fg-54/`057`.
- There is no `host-init.sh`, no dry-run, no capacity log and no failure when a
  declaration exceeds the host.

## Design summary

```
agent/host-init.sh
  -> detect CPU/RAM/disk/Docker/image/repo path
  -> parse agent.ini (role, count)
  -> compute required vs available (reservations, 80% disk)
  -> fail if declared > capacity; warn if under-utilized
  -> write .env.agent-host (umask 077)
  -> docker compose -f agent/docker-compose.yml
       [-f agent/docker-compose.sandbox.yml] up -d supervisor
  -> wait for backend /health
       -> supervisor enrolls the node and declares runtimes
       -> one child JVM per runtime (AGENT_RUNTIME_HEAP_MB)
       -> sandbox containers per active run (SANDBOX_*)
```

The script never rewrites `agent.ini`; the declaration stays operator-owned.
It validates the declaration and writes only derived limits.

## Host-init CLI

```
Usage: ./host-init.sh [--dry-run] [--explain] [--check] [--yes] [--force]
```

- `--dry-run`: print the table and computed env; write nothing, start nothing.
- `--explain`: print the formula with actual numbers (implies dry-run).
- `--check`: re-run the calculation against current usage/declaration.
- `--yes`: start Compose after a successful validation.
- `--force`: overwrite an existing `.env.agent-host` (never overwrite
  `agent.ini`).

Steps:

1. Require Linux Docker and `docker compose`; fail closed on Docker Desktop or
   a non-Linux kernel (D8).
2. Detect:
   - CPU threads (`nproc` or `/proc/cpuinfo`);
   - `MemTotal` (`/proc/meminfo`);
   - free disk on `AGENT_REPO_DIR`, defaulting to the bind path mounted at
     `/repos` (or `docker volume inspect` for a named volume);
   - `docker info`, the `vibecode-agent` image and the repo path.
3. Parse `agent.ini`:
   - every `[runtime "..."]` section must have `role` and `count`;
   - unknown roles fail;
   - count is `1..64`;
   - the total is `declared`.
4. Compute the required CPU/RAM/disk from the role mix (see `01`).
5. Compute available resources with the reservations and 80% disk target.
6. `capacity = min(max_by_cpu, max_by_ram, max_by_disk, AGENT_HOST_MAX_RUNTIMES)`.
7. If `declared > capacity`: print required vs available, the binding limit and
   the largest feasible mix; exit non-zero; do not start.
8. If `declared < capacity`: print the unused capacity (D6 follow-up).
9. Write `.env.agent-host` atomically with:
   - `AGENT_RUNTIME_HEAP_MB`, `SUPERVISOR_MEMORY_BUDGET_MB`
   - `SUPERVISOR_MEMORY_LIMIT`, `SUPERVISOR_CPUS`
   - `SANDBOX_CPUS`, `SANDBOX_MEMORY_MB`, `SANDBOX_DISK_MB`
   - `AGENT_HOST_MAX_RUNTIMES`, `AGENT_HOST_DECLARED_RUNTIMES`,
     `AGENT_HOST_BINDING_LIMIT`
10. If `--yes`: start Compose with the file(s) above; wait for
    `BACKEND_URL/health` (or `http://localhost:${API_PORT}/health`) with a
    bounded timeout. On timeout, leave the stack up but gated and exit
    non-zero.

The script is idempotent and never prints tokens or provider keys.

## Capacity calculation

```
threads      = host threads
ram_gb       = total RAM in GB
disk_gb      = free disk on the repo volume in GB
utilization  = AGENT_UTILIZATION_TARGET (default 0.80)

reserve_cpu  = max(2, threads * 0.15)
reserve_ram  = max(8, ram_gb * 0.10)
reserve_disk = max(100, disk_gb * 0.10)

max_by_cpu   = floor((threads * utilization - reserve_cpu) / cpu_per_runtime)
max_by_ram   = floor((ram_gb - reserve_ram) / ram_per_runtime)
max_by_disk  = floor((disk_gb * 0.80 - reserve_disk) / disk_per_runtime)
capacity     = max(0, min(max_by_cpu, max_by_ram, max_by_disk, AGENT_HOST_MAX_RUNTIMES))
```

`cpu_per_runtime`, `ram_per_runtime` and `disk_per_runtime` are computed from
the declared mix:

| Role | CPU | RAM | Disk |
|---|---|---|---|
| worker | 2.0 | 3.0 GB | 20 GB |
| reviewer | 1.5 | 2.5 GB | 10 GB |
| planner | 1.5 | 2.5 GB | 10 GB |
| light | 0.5 | 1.5 GB | 5 GB |

`ram_per_runtime` includes the child JVM (768 MB), the sandbox (2 GB for a
worker, 1.5 GB for reviewer/planner) and ~256 MB of JVM/OS overhead. Disk is
the fg-44 workspace budget; the sandbox disk is included in that budget.

## Profiles and `agent.ini`

`agent.ini` stays the source of truth for the role mix:

```ini
[runtime "workers"]
role = worker
model = acme/claude-sonnet
count = 6
effort = high
project = 1

[runtime "planners"]
role = planner
model = acme/claude-opus
count = 1
effort = max
```

The script sums `count` across sections. It does not guess a missing `count`
and does not rewrite the file. A section that the backend later marks
`stopped`/`draining` still counts for capacity; the operator can lower the
count and reload.

## Compose changes

`agent/docker-compose.yml` gains env-driven limits:

```yaml
deploy:
  resources:
    limits:
      memory: ${SUPERVISOR_MEMORY_LIMIT:-2G}
      cpus: ${SUPERVISOR_CPUS:-2.0}
logging:
  driver: json-file
  options:
    max-size: ${AGENT_LOG_MAX_SIZE:-10m}
    max-file: ${AGENT_LOG_MAX_FILE:-3}
```

- `SUPERVISOR_MEMORY_LIMIT` must cover all child heaps plus supervisor
  overhead: `ceil(declared * AGENT_RUNTIME_HEAP_MB / 1024) + 1 GB`.
- `SUPERVISOR_CPUS` is the supervisor/child orchestration limit; the sandbox
  CPU is enforced per sandbox container.
- Docker mode also loads `agent/docker-compose.sandbox.yml`; host-init requires
  `SANDBOX_HOST_WORKSPACE_ROOT` and a writable repo bind.

## Supervisor changes

- `SupervisorMain` reads `AGENT_HOST_MAX_RUNTIMES` (optional). If the declared
  total exceeds it, fail before spawning.
- Log the declared role mix, per-child heap, computed capacity and binding
  limit at startup; include `declared_runtimes`/`max_runtimes` in the existing
  heartbeat/status payload where available.
- `SUPERVISOR_MEMORY_BUDGET_MB` remains the budget the supervisor divides
  across children; host-init sets it to `declared * AGENT_RUNTIME_HEAP_MB`.
- No pool-control endpoint, token or `POOL_PAUSED` flag.

## Control and reload

- Change `agent.ini`, then `docker kill -s HUP <supervisor-container>`; the
  supervisor reconciles added/removed children (existing fg-54 behavior).
- Pause: stop the supervisor container (`docker compose stop supervisor`) or
  remove the section and HUP.
- Resume: start the container or restore the section and HUP.
- No new secret or admin endpoint is introduced.

## Validation and failure modes

| Case | Behavior |
|---|---|
| Docker missing / non-Linux | Exit non-zero with a clear message; start nothing |
| Image missing | Exit non-zero; suggest the build command |
| Repo path missing/not writable | Exit non-zero; print the expected path/uid |
| `agent.ini` unreadable/invalid | Exit non-zero; name the section/line |
| Declared > capacity | Exit non-zero; print required vs available and the binding limit |
| Declared = 0 | Exit non-zero; nothing to run |
| Backend `/health` timeout | Leave the stack up but children unspawned; exit non-zero |
| `SIGHUP` with an invalid file | Keep the previous children; log the parse error |
| Sandbox mode without host root | Exit non-zero before Compose |
| Computed capacity 0 | Start nothing; explain the binding limit |

## Observability

- Print a table: detected values, declared mix, required resources, reservations,
  computed capacity, binding limit and the unused gap.
- Write the same values to `.env.agent-host` for reproducibility.
- Supervisor startup log includes the same fields; the existing heartbeat
  exposes the runtime count.
- Add structured log lines (not a new metrics endpoint) for capacity and
  reload events; fg-41 event shipping remains optional.

## Security considerations

- `agent.ini` must never contain keys/tokens; the existing parser rejects
  secret-looking keys and values.
- `.env.agent-host` is mode 0600 and contains limits only, no secrets.
- The supervisor fetches provider keys per runtime over the node channel; the
  script never sees them.
- Docker mode uses the restricted socket proxy; the supervisor never mounts the
  raw daemon socket.
- No `POOL_ADMIN_TOKEN` is generated, injected or logged.

## Alternatives considered

1. **Keep PoolManager as a compatibility layer** — rejected: it was removed by
   fg-54 and would create a second lifecycle to maintain.
2. **Add a host-control API/token** — rejected for this ticket: `agent.ini` +
   SIGHUP + Compose covers pause/scale without a new secret. A control API can
   be a follow-up if remote control is needed.
3. **Dynamic per-role autoscaling now** — deferred (D6); fixed counts are
   sufficient for the pilot and keep the formula auditable.
4. **Rewrite `agent.ini` from host-init** — rejected: the declaration stays
   operator-owned; the script validates and reports.

## Rollout

1. Add `host-init.sh --dry-run` and verify on the reference host.
2. Add `.env.agent-host`, Compose limits and supervisor capacity validation.
3. Start with a canary count (about 25% of capacity), watch OOM/CPU/disk.
4. Raise to the declared count; keep the health gate and log rotation.
5. Record the unused-capacity gap for D6.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
