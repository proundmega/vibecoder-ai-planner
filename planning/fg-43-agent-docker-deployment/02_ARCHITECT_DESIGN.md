# 02_ARCHITECT_DESIGN.md - Agent Docker Deployment and Host Sizing (fg-43)

**Status:** planned
**Date:** 2026-10-31
**Depends on:** fg-33; fg-34 recommended
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
   - disk free on the repo volume: resolve AGENT_REPO_DIR, defaulting to
     `docker volume inspect -f '{{.Mountpoint}}' ${REPO_VOLUME:-vibecode_repos}`,
     then run df -B1 on it
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
8. Validate image/volume/network. If the backend is already reachable, validate /health.
9. With --yes, start compose (or print the command) with POOL_PAUSED=true.
10. Wait for /health with a bounded timeout, then call the pool config endpoint
    (`{ "paused": false, "maxPoolSize": <computed> }`) to enable the pool.
    On timeout or a failed call, leave the pool paused and exit non-zero.
```

If the backend is already running (upgrade path), skip the compose start and only validate health before enabling the pool. The backend must never spawn agents before its own `/health` is green.

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

max_cpu  = max(0, floor((threads * utilization - reserve_cpu) / cpu_per_agent))
max_ram  = max(0, floor((ram_gb - reserve_ram) / ram_per_agent))
max_disk = max(0, floor((disk_gb * 0.80 - reserve_disk) / disk_per_agent))
pool     = max(0, min(max_cpu, max_ram, max_disk, AGENT_MAX_POOL_SIZE))
if AGENT_POOL_SIZE is set:
  pool = min(AGENT_POOL_SIZE, AGENT_MAX_POOL_SIZE)
```

`0` is a valid result and means "no agent fits": write `MAX_POOL_SIZE=0`, keep `POOL_PAUSED=true`, and report the binding constraint. `AGENT_MAX_POOL_SIZE` is the formula hard cap; `AGENT_POOL_SIZE` is an explicit override; `MAX_POOL_SIZE` is the runtime value `PoolManager` reads.

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

Phase 1 runs **one pool per role**: each `PoolManager`/controller process has a single `AGENT_ROLE` and is sized with that profile. A mixed build/review/fixer pool is deferred because it would require per-request role and limits. A shared host partitions the computed capacity across the role pools (for example a build pool and a review pool with separate `MAX_POOL_SIZE`/profile values).

## PoolManager changes

- Read `AGENT_CPU_LIMIT`, `AGENT_MEMORY_LIMIT`, `AGENT_PIDS_LIMIT`, `AGENT_LOG_MAX_SIZE`, `AGENT_LOG_MAX_FILE`.
- Parse `MAX_POOL_SIZE` as a non-negative integer; do not use `parseInt(...) || 50` (0 would become 50). `0` means paused.
- Add `POOL_PAUSED` and a pool config admin endpoint (`POST /api/v1/pool/config` with `{ paused, maxPoolSize }`) used by host-init and fg-44 recovery. `requestAgent` rejects with a clear error when paused or full. Env values are startup defaults; the endpoint sets the runtime values until restart.
- `AGENT_ROLE` is process-wide; Phase 1 runs one pool per role (see Profiles).
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

1. **Same-host planner (Phase 1):** use the existing planner compose, add `.env.agent-host`, and ensure the backend container has the Docker socket. `host-init.sh` writes the computed `MAX_POOL_SIZE` and `POOL_PAUSED=true`, starts Compose, waits for `/health`, then calls `POST /api/v1/pool/config` to unpause with the computed size. If the backend is already running, it validates health first and only calls the config endpoint.
2. **Dedicated agent host (follow-up):** run a small pool controller on the agent host that talks to the backend API and the local Docker socket. Do not expose the Docker socket over TCP without TLS/mTLS.

`agent/docker-compose.host.yml` can be a thin override that:
- sets `MAX_POOL_SIZE` and agent limits from `.env.agent-host`;
- adds logging options and health checks;
- mounts the repo volume;
- does not define a fixed `agent` replica count (PoolManager owns replicas).

## Validation

- `docker info` succeeds.
- `vibecode-agent` image exists (or build it).
- repo volume exists and is writable; `AGENT_REPO_DIR` resolves to its mountpoint for `df`.
- backend health: if the backend is already running, check `/health` first; otherwise start Compose and wait for `/health` before enabling the pool.
- at least one slot is available, **or** the computed value is 0/`POOL_PAUSED=true` and the script reports the paused state without starting an agent.
- on failure: exit non-zero, leave the pool paused, do not start a partial pool.

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
2. Resolved for Phase 1: one pool per role; a mixed build/review/fixer pool is deferred until per-request limits exist.
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
