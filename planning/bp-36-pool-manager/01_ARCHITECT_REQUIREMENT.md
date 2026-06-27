# bp-36: Auto-Manage Agent Docker Containers (Pool Manager)

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend
**Priority**: P1
**Effort**: Large

## Problem Statement

Agents currently run as long-lived processes. When a ticket enters the `assigned` phase, there's no mechanism to spawn an agent automatically. You must manually run `docker compose up --scale agent=N` or start agents independently. This doesn't scale: idle agents waste resources, and there's no lifecycle management. Tickets pile up because no agent picks them up.

## Scope

- **In scope**: PoolManager service using dockerode, API endpoints for request/release/status, Docker socket mount, idle timeout, agent image Dockerfile, in-memory pool state
- **Out of scope**: Dynamic provisioning across multiple hosts (bp-40), web terminal (bp-38), SSH-based remote agents

## Acceptance Criteria

- [ ] PoolManager spawns a Docker container from the `vibecode-agent` image when `POST /api/pool/request` is called
- [ ] Idle agents are destroyed after 5 minutes of inactivity
- [ ] Agent containers receive environment variables for backend URL, API key, and provider config
- [ ] `POST /api/pool/release` stops and removes the container
- [ ] `GET /api/pool/status` returns all managed agents with their state (busy/idle/starting)
- [ ] Reuses idle agents when possible (skip spawn if suitable idle agent exists)
- [ ] Agent Dockerfile exists at `agent/Dockerfile` (may already exist — verify and update)
- [ ] Docker socket is bind-mounted into the backend container

## Known Unknowns

- **Agent image not built**: The backend needs to know the image exists. Document that `docker compose build agent` or `cd agent && docker build -t vibecode-agent .` must run first.
- **Port conflicts**: Each agent container may try to bind to the same port (e.g., 8080). Agent containers should not expose ports externally — they communicate outbound to the backend only.
- **GPU support**: If agents need GPU access for local models, Docker `--gpus all` flag is needed. This is out of scope here — document as future enhancement.

## Decisions Required

1. **Pool state persistence?**
   - Option A: In-memory Map only. Fast, no DB writes. On backend restart, all pool state is lost and agents become orphaned.
   - Option B: Persist to `agent_heartbeats` table. Pool manager reads active agents from heartbeats on restart.
   - **Recommendation**: Option A for simplicity, with Option B as a future upgrade. The heartbeat table from bp-33 can serve as the source of truth once it exists.

2. **Docker networking?**
   - Option A: Agents connect to backend via host network (`--network host`)
   - Option B: Agents connect via Docker Compose network (container name DNS)
   - **Recommendation**: Option B — agents use `BACKEND_URL=http://backend:3001` within the compose network. Pool manager uses the same network.

## Impact Analysis

| Component | Change Type | Details |
|-----------|-------------|---------|
| `backend/src/services/PoolManager.js` | CREATE | Docker lifecycle management |
| `backend/src/api/pool.js` | CREATE | Request/release/status REST endpoints |
| `backend/src/api/routes.js` | MODIFY | Mount pool routes |
| `agent/Dockerfile` | MODIFY | Ensure agent image is self-contained for standalone `docker run` |
| `backend/package.json` | MODIFY | Add `dockerode` dependency |

## Dependencies

- **Depends on this**: bp-33 (agent heartbeat — provides liveness tracking), bp-29 (provider config — pool needs AI provider settings to pass to agent)
- **Depended on by**: bp-38 (web terminal — needs running agent containers)

## Performance Considerations

- Container spawn time: ~2–5 seconds for a JVM-based agent. This is the critical path for ticket → agent assignment.
- Idle timeout prevents resource waste. 5 minutes is a reasonable default — short enough to not waste memory, long enough to avoid thrashing.
- Docker daemon communication is local Unix socket — negligible latency.
