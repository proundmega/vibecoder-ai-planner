# 03 — Implementation (fg-43)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status (`00`).

## Plan

- [x] Detect host CPU/RAM/disk with deterministic CI overrides
- [x] Parse `agent.ini` role/count and sum the runtime profiles
- [x] Reserve OS/Docker capacity and fail closed over capacity
- [x] Support a computed `0`/failure path without starting a partial fleet
- [x] Write `.env.agent-host` atomically with mode `0600`
- [x] Add `--dry-run`, `--explain`, `--check`, `--yes`, `--force`
- [x] Feed Compose memory/CPU/log rotation from the env file
- [x] Add the supervisor `AGENT_HOST_MAX_RUNTIMES` guard and capacity log
- [x] Replace the pool-controller assumptions with the fg-54 supervisor model
- [x] Document host sizing and the declaration contract

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/scripts/host-init.sh` | add | Host detection, agent.ini parsing, capacity math, env file and optional Compose start |
| `agent/scripts/host-init.test.sh` | add | Hermetic reference/over-capacity/mode/permission tests |
| `agent/docker-compose.yml` | change | Env-driven `SUPERVISOR_MEMORY_LIMIT`/`SUPERVISOR_CPUS`, JSON log rotation, `AGENT_HOST_MAX_RUNTIMES` |
| `agent/src/main/java/com/vibecode/agent/supervisor/SupervisorMain.java` | change | Parse/enforce the host cap at boot and SIGHUP; capacity log |
| `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorCapacityTest.java` | add | Cap parsing, 7-runtime fit, over-capacity failure |
| `agent/src/test/java/com/vibecode/agent/supervisor/RuntimeConfigTest.java` | change | 7-runtime reference expansion |
| `agent/README.md` | change | Host sizing section |
| `agent/agent.ini.example` | change | Note that host-init sums counts and the supervisor caps growth |

## Verification matrix (canonical)

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Shell | `host-init.test.sh` | Reference host reports 48 threads / 192 GB / 2 TB | `bash agent/scripts/host-init.test.sh` |
| FR2 | Shell | `host-init.test.sh` | Reserves and formula printed by `--explain` | same |
| FR3 | Shell | `host-init.test.sh` | Over-capacity declaration fails with the binding dimension | same |
| FR4 | Shell + Java | `host-init.test.sh`, `RuntimeConfigTest` | 3/2/2 roles sum to 7 runtimes / 10 CPU / 20 GB / 100 GB | same + `mvn test -Dtest=RuntimeConfigTest` |
| FR5 | Shell | `host-init.test.sh` | Profile totals and env values are reproducible | same |
| FR6 | Shell | `host-init.test.sh` | Env file mode 0600; no write in dry-run/check; `--force` required | same |
| FR7 | Compose | `docker-compose.yml` | Base Compose renders with generated limits | `docker compose -f agent/docker-compose.yml config` |
| FR8 | Shell | `host-init.test.sh` | Dry-run/check do not require Docker; deploy requires it | same |
| FR9 | Compose | `docker-compose.yml` | Memory/CPU/log rotation values are env-driven | `docker compose ... config` |
| FR10 | Java | `SupervisorCapacityTest` | Cap parsing and capacity failure message | `mvn test -Dtest=SupervisorCapacityTest` |
| FR11 | Shell | `host-init.test.sh` | Over-capacity writes nothing and starts nothing | same |
| FR12 | Java | `SupervisorCapacityTest`, `SupervisorMainTest` | 7 slots allowed at cap 7, rejected at 6 | `mvn test -Dtest=SupervisorCapacityTest,SupervisorMainTest` |
| FR13 | Docs | `agent/README.md`, `agent.ini.example` | Sizing and re-run contract documented | review |

## Review checklist

- [x] Every in-scope `FR*` has a passing row
- [x] Error paths (over capacity, existing env, invalid config) are covered
- [x] No PoolManager, pool admin token, `MAX_POOL_SIZE` or admin API
- [x] No secret in generated output; env file is 0600
- [x] Base and sandbox Compose overlays render
- [x] `02` matches what was built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| 2026-11-22 | `feat/fg-43-host-sizing` | shell 31/31; Java 39 focused / 927 total; Compose base+sandbox | Host-init sizes the 7-runtime reference case, fails closed over capacity, writes a 0600 env file and feeds Compose limits/log rotation. Supervisor cap guard and capacity log added. |
