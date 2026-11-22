# 03 — Implementation (fg-43)

> **Owns:** work order, per-file changes, verification matrix, results.
> **Not here:** design rationale (`02`), exact signatures (`04`), status
> (`00`).

## Test-First Requirement

Create these stubs **before** production code:

1. `agent/scripts/host-init.test.sh` — dry-run, over-capacity, overrides,
   missing Docker/image/repo, health timeout, env-file contents.
2. `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorCapacityTest.java`
   — max-runtime validation, capacity log, declared > max fails before spawn.
3. `agent/src/test/java/com/vibecode/agent/supervisor/RuntimeConfigTest.java`
   — extend parsing for role/count totals.
4. `agent/src/test/java/com/vibecode/agent/supervisor/SupervisorMainTest.java`
   — extend for `AGENT_HOST_MAX_RUNTIMES`.

## Plan

1. **Host-init script** — `agent/scripts/host-init.sh`
   - `--dry-run`, `--explain`, `--check`, `--yes`, `--force`.
   - Detect CPU/RAM/disk/Docker/image/repo path.
   - Parse `agent.ini` counts and roles.
   - Compute required vs available; fail on over-capacity.
   - Write `.env.agent-host` atomically.
   - Start Compose (plus sandbox overlay) and wait for `/health`.
2. **Compose limits** — make `memory`, `cpus` and logging env-driven.
3. **Supervisor capacity guard** — read `AGENT_HOST_MAX_RUNTIMES`, validate the
   declared total, log the capacity summary; fail before spawning.
4. **Docs** — `agent/README.md` host sizing section, `agent.ini.example`
   comments, `AGENTS.md` pointer. Do not edit the fg-54 runbook while fg-55 is
   in flight; add the sizing step after that merge.
5. **Verification** — run the matrix and record results.

## Per-file changes

| File | Action | Change |
|---|---|---|
| `agent/scripts/host-init.sh` | add | Capacity detection, `agent.ini` parsing, formula, env file, Compose start, health wait |
| `agent/scripts/host-init.test.sh` | add | Bash fixtures and assertions (mock `docker`, `curl`, `df`, `nproc`) |
| `agent/docker-compose.yml` | change | `memory: ${SUPERVISOR_MEMORY_LIMIT}`, `cpus: ${SUPERVISOR_CPUS}`, log rotation |
| `agent/docker-compose.sandbox.yml` | change | Pass `SANDBOX_CPUS`/`SANDBOX_MEMORY_MB`/`SANDBOX_DISK_MB` through if not inherited |
| `agent/agent.ini.example` | change | Document the role/count → capacity relationship and the `host-init` check |
| `agent/src/main/java/.../supervisor/SupervisorMain.java` | change | `AGENT_HOST_MAX_RUNTIMES` guard and capacity log |
| `agent/src/main/java/.../supervisor/RuntimeConfig.java` | change | Expose role/count totals for validation |
| `agent/src/test/java/.../supervisor/SupervisorCapacityTest.java` | add | Over-capacity, zero capacity, valid mix |
| `agent/src/test/java/.../supervisor/RuntimeConfigTest.java` | change | Parse totals/mixed roles |
| `agent/src/test/java/.../supervisor/SupervisorMainTest.java` | change | Max-runtime env guard |
| `agent/README.md` | change | Host sizing, `host-init.sh`, env table, SIGHUP/pause |
| `AGENTS.md` | change | One-line deployment pointer and the new env vars |

## Verification matrix (canonical)

One row per requirement from `01`. A requirement with no row is not done.

| Req | Layer | Test file | Test case | Command |
|---|---|---|---|---|
| FR1 | Script | `agent/scripts/host-init.test.sh` | detects CPU/RAM/disk; missing Docker/image/repo fails | `bash agent/scripts/host-init.test.sh` |
| FR2 | Script | `host-init.test.sh` | reservations on small/reference/large hosts | same |
| FR3 | Script + Java | `host-init.test.sh`, `RuntimeConfigTest.java` | 6 workers + 1 planner → 13.5 CPU / 20.5 GB / 130 GB | same, `cd agent && mvn test` |
| FR4 | Script | `host-init.test.sh` | each profile's CPU/RAM/disk is used | same |
| FR5 | Script | `host-init.test.sh` | each override changes the result and is printed | same |
| FR6 | Script | `host-init.test.sh` | declared > capacity exits non-zero, starts nothing, names binding limit | same |
| FR7 | Script | `host-init.test.sh` | `.env.agent-host` contents; `--dry-run` writes nothing; mode 0600 | same |
| FR8 | Script | `host-init.test.sh` | Compose command includes the sandbox overlay; health timeout exits non-zero | same |
| FR9 | Compose | `host-init.test.sh` / `docker compose config` | memory/cpus/logging render from env | `docker compose -f agent/docker-compose.yml config` |
| FR10 | Script + Java | `host-init.test.sh`, `SupervisorCapacityTest.java` | summary has detected/declared/computed/binding | same |
| FR11 | Script | `host-init.test.sh` | overcommit/missing secrets checks; no token in output | same |
| FR12 | Java | `SupervisorIntegrationTest.java` | SIGHUP reload; no pool endpoint exists | `cd agent && mvn test` |
| FR13 | Java + Script | `SupervisorMainTest.java`, `host-init.test.sh` | backend down → no children; healthy → children | `mvn test`, `host-init.test.sh` |

## Review checklist

- [ ] Every `FR*` acceptance statement has a passing row
- [ ] No `PoolManager`/`POOL_ADMIN_TOKEN`/`MAX_POOL_SIZE` reference remains
- [ ] No secret in `.env.agent-host`, logs or command output
- [ ] `agent.ini` is never rewritten by the script
- [ ] Compose config renders with and without the sandbox overlay
- [ ] The fg-54 runbook is updated after the fg-55 merge, not in this PR
- [ ] `04` matches what was built

## Results

| Date | Commit | Suites | Outcome |
|---|---|---|---|
| — | — | — | Not run (planned) |
