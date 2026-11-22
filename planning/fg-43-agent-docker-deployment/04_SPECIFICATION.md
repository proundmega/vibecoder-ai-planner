# 04 — Specification (fg-43)

> **Owns:** exact file operations, signatures and contracts.
> **Not here:** design rationale (`02`), requirements (`01`), verification
> matrix (`03`), status (`00`).

Execution order: test stubs, then `host-init.sh`, Compose limits, supervisor
guard, docs. Do not create production code before its stub exists.

## 1. Test stubs

| File | Initial contents |
|---|---|
| `agent/scripts/host-init.test.sh` | Bash `set -euo pipefail`; fixture dirs; failing assertions for dry-run, over-capacity, overrides, missing inputs, health timeout |
| `agent/src/test/java/.../supervisor/SupervisorCapacityTest.java` | JUnit `@Test` placeholders for valid/over/zero capacity |
| `agent/src/test/java/.../supervisor/RuntimeConfigTest.java` | Add cases for `count` totals and mixed roles |
| `agent/src/test/java/.../supervisor/SupervisorMainTest.java` | Add a case for `AGENT_HOST_MAX_RUNTIMES` |

## 2. `agent/scripts/host-init.sh`

```
Usage: host-init.sh [--dry-run] [--explain] [--check] [--yes] [--force]
Exit codes:
  0  success (or a successful dry-run/check)
  2  invalid arguments
  3  host/Docker/image/repo validation failed
  4  agent.ini missing/invalid
  5  declared runtimes exceed capacity
  6  Compose start or /health timeout
```

Environment inputs (all optional):

| Variable | Default | Used for |
|---|---|---|
| `AGENT_INI_PATH` | `./agent.ini` | declaration to parse |
| `AGENT_UTILIZATION_TARGET` | `0.80` | CPU target |
| `AGENT_HOST_MAX_RUNTIMES` | `50` | hard cap |
| `AGENT_RUNTIME_HEAP_MB` | `768` | per-child heap |
| `SANDBOX_CPUS` | `2.0` | sandbox CPU |
| `SANDBOX_MEMORY_MB` | `2048` | sandbox RAM |
| `SANDBOX_DISK_MB` | `5120` | sandbox disk |
| `AGENT_REPO_DIR` | repo bind root | `df` target |
| `BACKEND_URL` | `http://localhost:3001` | `/health` |
| `API_PORT` | `3001` | local health fallback |
| `SANDBOX_MODE` | `host` | whether to add the sandbox overlay |
| `COMPOSE_PROJECT_NAME` | `vibecode-agent` | Compose project |
| `AGENT_LOG_MAX_SIZE` | `10m` | log rotation |
| `AGENT_LOG_MAX_FILE` | `3` | log rotation |

Functions (keep them pure and testable):

```bash
detect_threads()            # nproc or /proc/cpuinfo
detect_ram_gb()             # /proc/meminfo
detect_disk_gb()            # df -B1 "$AGENT_REPO_DIR"
parse_ini()                 # prints "role count" lines
compute_required()          # role mix -> cpu/ram/disk
compute_capacity()          # reservations + formula
write_env_file()            # atomic, umask 077
render_compose_command()    # includes sandbox overlay when needed
wait_for_health()           # bounded curl loop
```

`parse_ini` accepts only `[runtime "..."]`, `role`, `count`, `model`, `effort`,
`project`; it ignores comments/blank lines and fails on a missing/zero count or
an unknown role.

## 3. `.env.agent-host` contract

```dotenv
AGENT_RUNTIME_HEAP_MB=768
SUPERVISOR_MEMORY_BUDGET_MB=5376
SUPERVISOR_MEMORY_LIMIT=7G
SUPERVISOR_CPUS=4.0
SANDBOX_CPUS=2.0
SANDBOX_MEMORY_MB=2048
SANDBOX_DISK_MB=5120
AGENT_HOST_MAX_RUNTIMES=50
AGENT_HOST_DECLARED_RUNTIMES=7
AGENT_HOST_BINDING_LIMIT=cpu
```

`SUPERVISOR_MEMORY_BUDGET_MB = declared * AGENT_RUNTIME_HEAP_MB`.
`SUPERVISOR_MEMORY_LIMIT = ceil(budget/1024) + 1` GB.
`SUPERVISOR_CPUS = min(available_cpu, max(2, declared * 1.0))`; the sandbox CPU
is enforced separately.

## 4. `agent.ini` contract

```ini
[runtime "workers"]
role = worker
model = acme/claude-sonnet
count = 6
effort = high
project = 1
```

- `role` ∈ `worker|reviewer|planner|light` (the parser maps `light` to a
  worker-like child; no server role is invented).
- `count` is an integer `1..64`.
- `model` is `<credential>/<model>`; `project` is required for workers.
- The script does not modify the file. A missing `count` is an error, not a
  default of 1.

## 5. Compose contract

`agent/docker-compose.yml`:

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

- Host-init passes `--env-file .env.agent-host` (or exports the values).
- Docker mode adds `-f agent/docker-compose.sandbox.yml`; host-init validates
  `SANDBOX_HOST_WORKSPACE_ROOT` and the repo bind before starting.
- The Compose file must not contain `POOL_ADMIN_TOKEN`, `MAX_POOL_SIZE` or
  `POOL_PAUSED`.

## 6. Supervisor contract

- `SupervisorMain` reads `AGENT_HOST_MAX_RUNTIMES` (default 50); if
  `sum(count) > max`, log the declared/limit numbers and exit non-zero before
  the first declaration.
- Log at startup:
  `declared={n} roles={...} heapMb={h} max={m} binding={cpu|ram|disk}`.
- `SUPERVISOR_MEMORY_BUDGET_MB` remains the child budget; host-init sets it to
  `declared * heap`.
- `SIGHUP` reload keeps the existing reconcile behavior; an invalid file keeps
  the current children and logs the error.

## 7. Docs

- `agent/README.md`: add a "Host sizing" section with the formula, profiles,
  `host-init.sh` usage, `.env.agent-host`, SIGHUP/pause and the D6 note.
- `agent/agent.ini.example`: add the role/count → capacity comment.
- `AGENTS.md`: add the `AGENT_HOST_*`/`SUPERVISOR_*` variables near the
  supervisor env list.
- Do not edit `planning/DONE/fg-54-agent-fleet/05_RUNBOOK.md` while the fg-55
  implementation is in flight; add the sizing step after it merges.

## 8. Verification commands

```bash
bash agent/scripts/host-init.test.sh
cd agent && mvn test -Dtest=RuntimeConfigTest,SupervisorCapacityTest,SupervisorMainTest,SupervisorIntegrationTest
docker compose -f agent/docker-compose.yml config
docker compose -f agent/docker-compose.yml -f agent/docker-compose.sandbox.yml config
node planning/check-planning.js
git diff --check
```
