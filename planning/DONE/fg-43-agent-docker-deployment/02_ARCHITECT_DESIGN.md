# 02_ARCHITECT_DESIGN.md - Agent Docker Deployment and Host Sizing (fg-43)

**Related code:** `agent/scripts/host-init.sh`, `agent/scripts/host-init.test.sh`,
`agent/docker-compose.yml`, `agent/agent.ini.example`,
`agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java`.

**Scope update (2026-11-22).** fg-54 removed `PoolManager` and the
container-per-agent model. There is no `POOL_ADMIN_TOKEN`, `MAX_POOL_SIZE` or
pool admin API. The supervisor owns one child JVM per declared runtime; fg-43
sizes that declaration, fails closed when it does not fit, and feeds the Compose
container limits.

## Design summary

```
agent/scripts/host-init.sh
  -> detect CPU threads, RAM, free disk (and Docker for --yes)
  -> parse agent.ini roles/counts
  -> sum role profiles and compare with reserved capacity
  -> fail closed if the declaration does not fit
  -> write .env.agent-host (mode 0600)
  -> docker compose --env-file .env.agent-host -f agent/docker-compose.yml
       [-f agent/docker-compose.sandbox.yml when SANDBOX_MODE=docker] up -d
  -> wait for BACKEND_URL/health
       -> supervisor guard: declared <= AGENT_HOST_MAX_RUNTIMES
       -> one child JVM per runtime (AGENT_RUNTIME_HEAP_MB)
       -> sandbox containers per active run (SANDBOX_*)
```

There is one supervisor per host. The unit being sized is the runtime child JVM
plus its sandbox, not a container per ticket. Docker-mode sandboxes remain
fg-34’s scope.

## Host init script

`agent/scripts/host-init.sh` supports:

| Flag | Behavior |
|---|---|
| `--dry-run` | Detect, parse, print the calculation; write nothing. |
| `--explain` | Print reserves, formula inputs and per-role totals; implies `--dry-run`. |
| `--check` | Validate the declaration against this host; no write/start. |
| `--yes` | Write the env file and start the Compose stack, then wait for `/health`. |
| `--force` | Replace an existing `.env.agent-host`. |
| `--help` | Usage. |

Exit codes: `0` success; `2` invalid arguments; `3` host/Docker/sandbox/repo
validation; `4` missing/invalid `agent.ini`; `5` declared fleet over capacity;
`6` Compose start or health timeout.

Detection:

- CPU threads: `nproc` (or `getconf _NPROCESSORS_ONLN`).
- RAM: `/proc/meminfo` `MemTotal` (or `sysctl hw.memsize`).
- Free disk: `df -Pk` on `AGENT_REPO_DIR`, else the repo volume mountpoint from
  `docker volume inspect`, else the repository root.
- Docker: checked for `--yes`; dry-run/check work without a daemon.

Deterministic overrides `AGENT_HOST_CPU_THREADS`, `AGENT_HOST_RAM_GB` and
`AGENT_HOST_DISK_GB` exist for CI/tests. Relative `AGENT_INI_PATH` and
`AGENT_HOST_ENV_FILE` values are canonicalized before the env file is written
and before Compose is invoked.

## Capacity calculation

```
threads     = host threads
ram_gb      = total memory in GB
disk_gb     = free disk on the repo volume in GB
utilization = AGENT_UTILIZATION_TARGET (default 0.80)

required_cpu  = sum(count * profile_cpu(role))
required_ram  = sum(count * profile_ram(role))
required_disk = sum(count * profile_disk(role))

reserve_cpu  = max(2, threads * 0.15)
reserve_ram  = max(8, ram_gb * 0.10)
reserve_disk = max(100, disk_gb * 0.10)

available_cpu  = threads * utilization - reserve_cpu
available_ram  = ram_gb - reserve_ram
available_disk = disk_gb * 0.80 - reserve_disk
```

The declaration fits only when `required_cpu <= available_cpu`,
`required_ram <= available_ram`, `required_disk <= available_disk` and
`declared <= AGENT_HOST_MAX_RUNTIMES`. The binding dimension is the one with the
smallest remaining margin and is written to `.env.agent-host`.

## Profiles

| Role | CPU | RAM | Disk |
|---|---|---|---|
| `worker` | 2.0 | 3 GB | 20 GB |
| `reviewer` | 1.5 | 2.5 GB | 10 GB |
| `planner` | 1.5 | 2.5 GB | 10 GB |
| `light` | 0.5 | 1.5 GB | 5 GB |

RAM includes the child JVM, its sandbox and JVM/OS overhead. `light` is a
sizing variant that the supervisor declares as a worker child; it does not
invent a server role. `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT` and
`AGENT_DISK_BUDGET_GB` override the per-runtime values globally.

Reference case: 3 workers + 2 reviewers + 2 planners = 7 runtimes, 12 CPU,
19 GB and 100 GB. On 48 threads / 192 GB / 2 TB it fits (binding `cpu`) and
writes `AGENT_HOST_MAX_RUNTIMES=50`, `AGENT_HOST_DECLARED_RUNTIMES=7`,
`SUPERVISOR_CPUS=7.00`, `SUPERVISOR_MEMORY_BUDGET_MB=5376`,
`SUPERVISOR_MEMORY_LIMIT=7G`.

## `.env.agent-host`

Generated atomically with `umask 077` and `chmod 0600`:

```
AGENT_RUNTIME_HEAP_MB=768
SUPERVISOR_MEMORY_BUDGET_MB=5376
SUPERVISOR_MEMORY_LIMIT=7G
SUPERVISOR_CPUS=7.00
SANDBOX_CPUS=2.0
SANDBOX_MEMORY_MB=2048
SANDBOX_DISK_MB=5120
AGENT_HOST_MAX_RUNTIMES=50
AGENT_HOST_DECLARED_RUNTIMES=7
AGENT_HOST_BINDING_LIMIT=cpu
AGENT_HOST_REQUIRED_CPUS=12.00
AGENT_HOST_REQUIRED_MEMORY_GB=19.00
AGENT_HOST_REQUIRED_DISK_GB=100.00
AGENT_LOG_MAX_SIZE=10m
AGENT_LOG_MAX_FILE=3
AGENT_INI_PATH=/absolute/path/agent.ini
```

`SUPERVISOR_MEMORY_BUDGET_MB = declared * AGENT_RUNTIME_HEAP_MB`.
`SUPERVISOR_MEMORY_LIMIT = ceil(budget / 1024) + 1` GB.
`SUPERVISOR_CPUS = min(available_cpu, max(2, declared * 1.0))`.

## Compose

`agent/docker-compose.yml` reads the generated values:

- `deploy.resources.limits.memory: ${SUPERVISOR_MEMORY_LIMIT:-2G}`
- `deploy.resources.limits.cpus: ${SUPERVISOR_CPUS:-2.0}`
- `logging.options.max-size: ${AGENT_LOG_MAX_SIZE:-10m}`
- `logging.options.max-file: ${AGENT_LOG_MAX_FILE:-3}`
- `AGENT_HOST_MAX_RUNTIMES` is passed to the supervisor (default `50`).

Docker mode adds `agent/docker-compose.sandbox.yml`; `host-init.sh` requires
`SANDBOX_HOST_WORKSPACE_ROOT` and a writable `REPO_HOST_PATH` before writing or
starting. The remote template uses the same limits.

## Supervisor guard

`SupervisorMain` parses `AGENT_HOST_MAX_RUNTIMES` (default `50`; explicit `0`
disables), compares it with `RuntimeConfig.expandedSlots().size()` before
enrollment and on `SIGHUP`, and refuses to start a larger declaration. It logs
the declared slot count, cap and child heap at boot.

## Failure modes

| Case | Behavior |
|---|---|
| Docker missing / unreachable | `--yes` exits 3 before writing |
| Sandbox mode without host root/repo | Exit 3 before writing |
| `agent.ini` missing/invalid | Exit 4 |
| Declared > capacity (CPU/RAM/disk/cap) | Exit 5; print required vs available and the binding limit; write/start nothing |
| Existing env file without `--force` | Exit 3 |
| Compose or `/health` failure | Exit 6; stack may remain up but gated |

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
