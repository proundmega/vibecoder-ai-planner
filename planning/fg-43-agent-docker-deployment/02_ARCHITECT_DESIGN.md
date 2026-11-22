# 02_ARCHITECT_DESIGN.md - Agent Docker Deployment and Host Sizing (fg-43)

**Related code:** `agent/scripts/host-init.sh`, `agent/scripts/host-init.test.sh`,
`agent/docker-compose.yml`, `agent/agent.ini.example`,
`agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java`.

**Scope update (2026-11-22).** fg-54 removed `PoolManager` and the
container-per-agent model. There is no `POOL_ADMIN_TOKEN`, `MAX_POOL_SIZE` or
pool admin API in this design. The supervisor owns one child JVM per declared
runtime; fg-43 sizes that declaration, fails closed when it does not fit, and
feeds the Compose container limits.

## Design summary

```
agent/scripts/host-init.sh
  -> detect CPU threads, RAM, free disk, Docker (deploy only)
  -> parse agent.ini roles/counts
  -> sum role profiles and reservations
  -> fail closed if the declared fleet does not fit
  -> write .env.agent-host (mode 0600)
  -> docker compose --env-file .env.agent-host -f agent/docker-compose.yml up -d
       -> SUPERVISOR_CPUS / SUPERVISOR_MEMORY_LIMIT / log rotation
       -> supervisor guard: declared slots <= AGENT_HOST_MAX_RUNTIMES
       -> supervisor spawns one child JVM per runtime
```

There is one supervisor per host. The unit being sized is the runtime child
JVM, not a container per ticket. Docker-mode sandboxes remain fg-34’s scope.

## Host init script

`agent/scripts/host-init.sh` supports:

| Flag | Behavior |
|---|---|
| `--dry-run` | Detect, parse, print the calculation; write nothing. |
| `--explain` | Print reserves, formula inputs and per-role totals. |
| `--check` | Validate the declaration against this host; no write/start. |
| `--yes` | Write the env file and start the Compose stack. |
| `--force` | Replace an existing `.env.agent-host`. |
| `--help` | Usage. |

The script is idempotent, never prints secrets, and refuses to overwrite an
existing env file without `--force`.

Detection:

- CPU threads: `nproc` (or `getconf _NPROCESSORS_ONLN`).
- RAM: `/proc/meminfo` `MemTotal` (or `sysctl hw.memsize`).
- Free disk: `df -Pk` on `AGENT_REPO_DIR`, else the repo volume mountpoint from
  `docker volume inspect`, else the repository root.
- Docker: checked only for `--yes`; dry-run/check must work without a daemon.

Deterministic overrides `AGENT_HOST_CPU_THREADS`, `AGENT_HOST_RAM_GB` and
`AGENT_HOST_DISK_GB` exist for CI/tests.

## Capacity calculation

```
threads     = host threads
ram_gb      = total memory in GB
disk_gb     = free disk on the repo volume in GB
utilization = AGENT_UTILIZATION_TARGET (default 0.80)
overhead_mb = AGENT_SUPERVISOR_OVERHEAD_MB (default 512)

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

The declaration passes only when `required_cpu <= available_cpu`,
`required_ram + overhead <= available_ram`, and
`required_disk <= available_disk`. No capacity is represented by a failed
check, not by silently starting one agent. The script writes nothing and exits
non-zero on failure.

The supervisor container is sized as:

```
SUPERVISOR_CPUS         = required_cpu
SUPERVISOR_MEMORY_LIMIT = ceil(required_ram + overhead_mb / 1024)G
AGENT_HOST_MAX_RUNTIMES = total declared slots
```

## Profiles

| Role | CPU | RAM | Disk |
|---|---|---|---|
| `worker` | 2.0 | 4 GB | 20 GB |
| `reviewer` | 1.0 | 2 GB | 10 GB |
| `planner` | 1.0 | 2 GB | 10 GB |

`AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT` and `AGENT_DISK_BUDGET_GB` override the
per-runtime values globally. A global override applies to every role; that keeps
the calculation deterministic and avoids per-section overrides in Phase 1.

Reference case: 3 workers + 2 reviewers + 2 planners = 7 runtimes, 10 CPU,
20 GB and 100 GB. On 48 threads / 192 GB / 2 TB it fits with room to spare and
writes `AGENT_HOST_MAX_RUNTIMES=7`, `SUPERVISOR_CPUS=10.00`,
`SUPERVISOR_MEMORY_LIMIT=21G`.

## `.env.agent-host`

Generated atomically with `umask 077` and `chmod 0600`. It contains only sizing
and logging values:

```
AGENT_HOST_MAX_RUNTIMES=7
AGENT_HOST_DECLARED_RUNTIMES=7
AGENT_HOST_REQUIRED_CPUS=10.00
AGENT_HOST_REQUIRED_MEMORY_GB=20.00
AGENT_HOST_REQUIRED_DISK_GB=100.00
SUPERVISOR_CPUS=10.00
SUPERVISOR_MEMORY_LIMIT=21G
SUPERVISOR_MEMORY_BUDGET_MB=20480
AGENT_RUNTIME_HEAP_MB=768
AGENT_LOG_MAX_SIZE=10m
AGENT_LOG_MAX_FILE=3
AGENT_INI_PATH=/absolute/path/agent.ini
```

No token, key or pool-admin value is written.

## Compose

`agent/docker-compose.yml` reads the generated values:

- `deploy.resources.limits.memory: ${SUPERVISOR_MEMORY_LIMIT:-2G}`
- `deploy.resources.limits.cpus: ${SUPERVISOR_CPUS:-2.0}`
- `logging.options.max-size: ${AGENT_LOG_MAX_SIZE:-10m}`
- `logging.options.max-file: ${AGENT_LOG_MAX_FILE:-3}`
- `AGENT_HOST_MAX_RUNTIMES` is passed to the supervisor.

The defaults keep a single hand-managed runtime working without host-init.
`agent/docker-compose.sandbox.yml` overlays Docker mode and must render with the
same variables.

## Supervisor guard

`SupervisorMain` parses `AGENT_HOST_MAX_RUNTIMES` (0/empty disables the guard),
compares it with `RuntimeConfig.expandedSlots().size()` before enrollment and on
`SIGHUP`, and refuses to start a larger declaration. It logs the declared slot
count, cap and child heap at boot.

## Validation and observability

- `docker info` is required for `--yes`; dry-run/check do not need Docker.
- `.env.agent-host` is mode `0600`; the script never prints secrets.
- The summary and `--explain` show detected capacity, reserves, required
  totals, the binding dimension on failure and the generated container limits.
- A later `agent.ini` count increase fails the supervisor boot until
  `host-init.sh` is re-run with a capacity that fits.

## Deferred scope

See `00_ARCHITECT_CHECKLIST.md` → Deferred register. This document does not
keep a copy.
