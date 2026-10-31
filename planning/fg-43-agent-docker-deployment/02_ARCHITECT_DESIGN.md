# 02_ARCHITECT_DESIGN.md - Agent Docker Deployment and Host Sizing (fg-43)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-33, fg-34 (recommended)
**Related code:** `agent/docker-compose.yml`, `backend/src/services/PoolManager.js`

## Design summary

A host init script detects resources, computes a safe pool size and writes an env file. Compose starts the planner stack/pool controller with those values, and `PoolManager` applies the same limits to each container it creates.

```
agent/host-init.sh
  -> detect CPU/RAM/disk/docker
  -> choose profile (build/review/fixer/light)
  -> compute pool + limits
  -> write .env.agent-host
  -> docker compose -f agent/docker-compose.host.yml up -d
       -> backend PoolManager reads MAX_POOL_SIZE, limits
       -> creates agent containers with NanoCpus, Memory, PidsLimit, log config
```

## Init script

Proposed `agent/host-init.sh`:

```
Usage: ./host-init.sh [--role build|review|fixer|light] [--dry-run] [--yes]

1. Require docker + docker compose.
2. Detect:
   - CPU threads (nproc or /proc/cpuinfo)
   - MemTotal (/proc/meminfo)
   - disk free on $AGENT_REPO_DIR (df -B1)
   - existing agent containers and image presence
3. Load profile defaults and env overrides.
4. Compute reservations and pool size (see formula).
5. Print a table:
   Detected: 48 threads, 192 GB RAM, 1.8 TB free
   Profile: build (2 CPU, 4 GB, 20 GB)
   Limits: CPU 15, RAM 43, disk 70
   Pool: 15 (CPU-bound)
6. With --dry-run: exit 0 without writing.
7. Write .env.agent-host atomically (umask 077).
8. Validate image/volume/network/backend health.
9. Start compose or print the command with --yes.
```

The script must be idempotent, never print secrets, and fail closed. It should support `.env` overrides but never overwrite an existing file without `--force`.

## Capacity calculation

```
threads       = host threads
ram_gb        = total memory in GB
disk_gb       = free disk on repo volume in GB
utilization   = AGENT_UTILIZATION_TARGET (default 0.80)
reserve_cpu   = max(2, threads * 0.15)
reserve_ram   = max(8, ram_gb * 0.10)
reserve_disk  = max(100, disk_gb * 0.10)

max_cpu  = floor((threads * utilization - reserve_cpu) / cpu_per_agent)
max_ram  = floor((ram_gb - reserve_ram) / ram_per_agent)
max_disk = floor((disk_gb * 0.80 - reserve_disk) / disk_per_agent)
pool     = clamp(min(max_cpu, max_ram, max_disk, AGENT_MAX_POOL_SIZE), 1, AGENT_MAX_POOL_SIZE)
```

Notes:

- Use threads, not physical cores, for CPU checks; Java agents and OpenCode are concurrent.
- Do not overcommit memory. `utilization` only affects CPU.
- Disk uses 80% of free space as the workspace budget; fg-44 enforces cleanup.
- The script should include a `--explain` mode that prints the formula with actual numbers.

## Profiles

| Profile | CPU | RAM | Disk | Typical use |
|---|---|---|---|---|
| `build` | 2.0 | 4 GB | 20 GB | Full build + tests + OpenCode |
| `fixer` | 2.0 | 4 GB | 15 GB | Review-driven fixes |
| `review` | 1.0 | 2 GB | 10 GB | Read-only review |
| `light` | 0.5 | 1 GB | 5 GB | Pollers/small repos |

Roles are selected with `AGENT_ROLE`; `PoolManager` applies the matching limits unless overridden.

## PoolManager changes

- Read `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT`, `AGENT_PIDS_LIMIT`, `AGENT_LOG_MAX_SIZE`, `AGENT_LOG_MAX_FILE`.
- Set `HostConfig.NanoCpus = cpu * 1e9`, `Memory = bytes`, `MemorySwap = Memory`, `PidsLimit`.
- Set `LogConfig` with `max-size`/`max-file`.
- Add labels: `vibecode.role`, `vibecode.pool`, `vibecode.host`.
- Expose computed capacity/pool size in `getStatus()` and heartbeat.
- Keep `AutoRemove: true`; fg-44 handles workspace cleanup.

Example:

```js
HostConfig: {
  Binds: [`${REPO_VOLUME}:/repos`],
  NetworkMode: CONTAINER_NETWORK,
  AutoRemove: true,
  Memory: memoryBytes,
  MemorySwap: memoryBytes,
  NanoCpus: Math.round(cpu * 1e9),
  PidsLimit: 512,
  LogConfig: {
    Type: 'json-file',
    Config: { 'max-size': '10m', 'max-file': '3' },
  },
}
```

## Compose deployment

Two options:

1. **Same-host planner (Phase 1):** use the existing planner compose, add `.env.agent-host`, and ensure the backend container has the Docker socket. `host-init.sh` sets `MAX_POOL_SIZE` and limits before `docker compose up -d`.
2. **Dedicated agent host (follow-up):** run a small pool controller on the agent host that talks to the backend API and the local Docker socket. Do not expose the Docker socket over TCP without TLS/mTLS.

`agent/docker-compose.host.yml` can be a thin override that:
- sets `MAX_POOL_SIZE` and agent limits from `.env.agent-host`;
- adds logging options and health checks;
- mounts the repo volume;
- does not define a fixed `agent` replica count (PoolManager owns replicas).

## Validation

- `docker info` succeeds.
- `vibecode-agent` image exists (or build it).
- repo volume exists and is writable.
- backend health endpoint responds.
- at least one slot is available.
- on failure: exit non-zero, do not start a partial pool.

## Observability

- Log detected capacity, profile, formula inputs, computed pool and binding limit.
- Expose `pool_size`, `active_agents`, `idle_agents`, `host_cpu`, `host_ram`, `disk_free` in status/heartbeat.
- Add a `--check` mode that re-runs the calculation against current usage.

## Rollout

1. Add `host-init.sh --dry-run` and verify on the reference host.
2. Add `.env.agent-host` output and compose override.
3. Apply limits in PoolManager.
4. Run a canary with 25% of the computed pool.
5. Increase to the computed pool; monitor OOM/CPU/disk.
6. Document overrides and failure recovery.

## Open questions

1. Should the pool controller run inside the backend or as a dedicated service on the agent host?
2. Do we need a per-role pool (separate build/review/fixer) or one mixed pool?
3. Should CPU be overcommitted for bursty agents (`utilization > 1.0`)?
4. How do we handle Docker Desktop vs Linux Docker differences?
5. Do we want a generated systemd unit in addition to Compose?

## Pending Scope Items to Present to User

| # | From Ticket | Improvement | Category | Suggested Next Ticket | User Notified |
|---|---|---|---|---|---|
| 1 | fg-44 | Storage cleanup and idle refresh | Infrastructure | `fg-44-agent-storage-lifecycle` | No |
| 2 | fg-33 | Durable leases across restarts | Reliability | `fg-33-durable-harness-execution` | No |
| 3 | fg-34 | Sandboxed containers | Security | `fg-34-harness-sandbox` | No |
| 4 | fg-40 | Multi-host scheduling | Agent | `fg-40-multi-agent-orchestration` | No |
