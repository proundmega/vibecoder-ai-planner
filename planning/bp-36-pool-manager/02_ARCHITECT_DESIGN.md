# bp-36: Auto-Manage Agent Docker Containers (Pool Manager) — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend

## Current State

Agent containers must be started manually. There is no API to request an agent, no pool, no idle management. The backend has docker-compose.yml in the agent directory but no programmatic container lifecycle.

```
Manual flow:
  docker compose --profile agent up -d --scale agent=3
  → 3 agents start, connect to backend via API key
  → no tracking, no release, no idle detection
```

## Proposed Solution

### PoolManager.js — Core Service

```javascript
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

class PoolManager {
  constructor() {
    this.pool = new Map();  // agentId → { container, state, ticketId, startedAt, lastActiveAt }
    this.IDLE_TIMEOUT_MS = 5 * 60 * 1000;  // 5 min
    this.CONTAINER_IMAGE = process.env.AGENT_IMAGE || 'vibecode-agent';
    this.BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
    this.cleanupInterval = setInterval(() => this._cleanupIdle(), 60_000);
  }

  async requestAgent(projectId, repoUrl, providerConfig) { ... }
  async releaseAgent(agentId) { ... }
  getStatus() { ... }
  async _spawnContainer(projectId, providerConfig) { ... }
  async _destroyContainer(agentId) { ... }
  async _cleanupIdle() { ... }
  _getOrCreateNetwork() { ... }
}
```

### Request Flow

```
POST /api/pool/request { project_id, repo_url, provider_config }
  1. Check idle pool for an agent that has the repo cached
  2. If found: assign ticket, mark as busy, return { agent_id, container_id }
  3. If not found: spawn new container
     a. docker.createContainer({
         Image: 'vibecode-agent',
         Env: [
           `BACKEND_URL=${BACKEND_URL}`,
           `API_KEY=${generateAgentKey()}`,
           `REPO_CLONE_DIR=/repos`,
           `AI_ENDPOINT_URL=${providerConfig.endpoint}`,
           `AI_API_KEY=${providerConfig.apiKey}`,
           `AI_MODEL=${providerConfig.model}`,
         ],
         HostConfig: {
           Binds: ['vibecode_repos:/repos'],
           NetworkMode: 'vibecode_default',
           AutoRemove: true,
         },
         name: `agent-${shortId()}`,
       })
     b. container.start()
     c. Wait for agent to connect (poll /agents/:id/heartbeat up to 15s)
     d. Return agent info
```

### Release Flow

```
POST /api/pool/release { agent_id }
  1. Find agent in pool
  2. If busy, release ticket first (call TicketService.release())
  3. Stop container (docker.getContainer(agentId).stop())
  4. Remove from pool Map
```

### Status Response

```json
GET /api/pool/status → {
  "agents": [
    {
      "agentId": "abc123",
      "containerId": "abcd...",
      "state": "busy",          // "idle" | "busy" | "starting"
      "ticketId": "uuid...",    // null if idle
      "projectId": "uuid...",
      "startedAt": "2026-06-27T10:00:00Z",
      "lastActiveAt": "2026-06-27T10:30:00Z",
      "uptimeSeconds": 1800
    }
  ],
  "stats": {
    "total": 5,
    "busy": 3,
    "idle": 2,
    "starting": 0
  }
}
```

### Idle Cleanup

Runs every 60 seconds. Iterates pool entries:
1. If state === 'idle' AND (now - lastActiveAt) > IDLE_TIMEOUT_MS → destroy container
2. If state === 'starting' AND (now - startedAt) > 30s → mark as failed, destroy

### Integration with Phase Assignment

When a ticket transitions to `assigned` phase, the backend should call pool manager:

```javascript
// In PhaseService or a trigger:
async onAssigned(ticketId, projectId) {
  const repoUrl = await getProjectRepoUrl(projectId);
  const providerConfig = await ProviderService.getProjectConfig(projectId);
  const { agentId } = await poolManager.requestAgent(projectId, repoUrl, providerConfig);
  await Ticket.assignAgent(ticketId, agentId);
}
```

This is a design intent — the actual wiring between PhaseService and PoolManager may be added in a follow-up (bp-32 PhaseFlow UI wires it end-to-end).

### Agent Dockerfile

The existing `agent/Dockerfile` should be verified to support standalone `docker run`:

```dockerfile
FROM openjdk:17-slim
WORKDIR /app
COPY target/vibecode-agent.jar app.jar
COPY build.sh .
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
ENV BACKEND_URL=http://backend:3001
ENV REPO_CLONE_DIR=/repos
CMD ["java", "-jar", "app.jar"]
```

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/services/PoolManager.js` | CREATE | Docker lifecycle, pool state, idle cleanup |
| `backend/src/api/pool.js` | CREATE | REST endpoints for pool management |
| `backend/src/api/routes.js` | MODIFY | Mount pool router (not under /v1 — it's infrastructure) |
| `agent/Dockerfile` | MODIFY | Ensure standalone run compatibility |
| `backend/package.json` | MODIFY | Add "dockerode": "^4.0.0" |
| `docker-compose.yml` (root) | MODIFY | Add docker socket bind mount to backend service |

## Alternatives Considered

- **Kuberbetes**: Overkill for single-machine deployment. Docker API is simpler and sufficient for Tier 2.
- **Child process spawn**: Running Java as a child process of Node. Problematic — different lifecycle, no isolation, no resource limits.
- **Pre-warm pool**: Always keep 1 idle agent. Rejected — wasteful. Better to spawn on demand and cache the image layer.
