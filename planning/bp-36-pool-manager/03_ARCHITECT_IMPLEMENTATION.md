# bp-36: Auto-Manage Agent Docker Containers (Pool Manager) — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Large
**Scope**: Backend

## Purpose
Auto-spawn and manage agent Docker containers via the Docker API.

## Implementation Order

1. **Add dockerode dependency** — `backend/package.json`
   - `npm install dockerode`
   - *Depends on*: nothing

2. **Update agent Dockerfile** — `agent/Dockerfile`
   - Ensure it builds as a standalone image (not just via docker-compose)
   - Install git, set CMD to run the JAR
   - *Depends on*: nothing

3. **Create PoolManager.js** — `backend/src/services/PoolManager.js`
   - Singleton class with in-memory pool Map
   - requestAgent, releaseAgent, getStatus, _spawnContainer, _destroyContainer, _cleanupIdle
   - *Depends on*: Step 1

4. **Create pool API routes** — `backend/src/api/pool.js`
   - POST /pool/request, POST /pool/release, GET /pool/status
   - *Depends on*: Step 3

5. **Mount pool routes** — `backend/src/api/routes.js`
   - Mount directly on main router (not under /v1 — it's infrastructure)
   - *Depends on*: Step 4

6. **Update docker-compose.yml** — root `docker-compose.yml`
   - Add Docker socket bind mount to backend service
   - *Depends on*: nothing

## Per-File Action Plan

### `backend/src/services/PoolManager.js` (CREATE)

```javascript
const Docker = require('dockerode');
const crypto = require('crypto');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'vibecode-agent';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
const IDLE_TIMEOUT_MS = parseInt(process.env.AGENT_IDLE_TIMEOUT_MS) || 300_000; // 5 min
const CONTAINER_NETWORK = process.env.CONTAINER_NETWORK || 'vibecode_default';
const REPO_VOLUME = process.env.REPO_VOLUME || 'vibecode_repos';

class PoolManager {
  constructor() {
    this.docker = new Docker({ socketPath: DOCKER_SOCKET });
    this.pool = new Map(); // agentId → PoolEntry
    this._startCleanupInterval();
  }

  _generateAgentId() { return crypto.randomBytes(8).toString('hex'); }
  _generateApiKey() { return crypto.randomBytes(24).toString('hex'); }

  async requestAgent(projectId, repoUrl, providerConfig = {}) {
    // Check idle pool for reuse
    for (const [id, entry] of this.pool) {
      if (entry.state === 'idle') {
        entry.state = 'busy';
        entry.projectId = projectId;
        entry.lastActiveAt = Date.now();
        return { agentId: id, containerId: entry.containerId, reused: true };
      }
    }

    // Spawn new
    const agentId = this._generateAgentId();
    const apiKey = this._generateApiKey();

    const env = [
      `BACKEND_URL=${BACKEND_URL}`,
      `API_KEY=${apiKey}`,
      `AGENT_ID=${agentId}`,
      `REPO_CLONE_DIR=/repos`,
    ];
    if (providerConfig.endpoint) env.push(`AI_ENDPOINT_URL=${providerConfig.endpoint}`);
    if (providerConfig.apiKey) env.push(`AI_API_KEY=${providerConfig.apiKey}`);
    if (providerConfig.model) env.push(`AI_MODEL=${providerConfig.model}`);

    const container = await this.docker.createContainer({
      Image: AGENT_IMAGE,
      name: `agent-${agentId}`,
      Env: env,
      HostConfig: {
        Binds: [`${REPO_VOLUME}:/repos`],
        NetworkMode: CONTAINER_NETWORK,
        AutoRemove: true,
      },
    });

    await container.start();

    this.pool.set(agentId, {
      agentId,
      containerId: container.id,
      container,
      state: 'starting',
      projectId,
      ticketId: null,
      startedAt: Date.now(),
      lastActiveAt: Date.now(),
    });

    return { agentId, containerId: container.id, reused: false };
  }

  async releaseAgent(agentId) {
    const entry = this.pool.get(agentId);
    if (!entry) throw new Error(`Agent ${agentId} not found in pool`);
    await this._destroyContainer(agentId);
  }

  getStatus() {
    const agents = [];
    let busy = 0, idle = 0, starting = 0;
    for (const [agentId, entry] of this.pool) {
      const state = entry.state;
      if (state === 'busy') busy++;
      else if (state === 'idle') idle++;
      else if (state === 'starting') starting++;
      agents.push({
        agentId,
        containerId: entry.containerId,
        state,
        ticketId: entry.ticketId,
        projectId: entry.projectId,
        startedAt: new Date(entry.startedAt).toISOString(),
        lastActiveAt: new Date(entry.lastActiveAt).toISOString(),
        uptimeSeconds: Math.floor((Date.now() - entry.startedAt) / 1000),
      });
    }
    return { agents, stats: { total: agents.length, busy, idle, starting } };
  }

  async _destroyContainer(agentId) {
    const entry = this.pool.get(agentId);
    if (!entry) return;
    try {
      await entry.container.stop({ t: 5 }); // 5s timeout
    } catch (e) { /* already stopped */ }
    try {
      await entry.container.remove({ force: true });
    } catch (e) { /* already removed */ }
    this.pool.delete(agentId);
  }

  _startCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [agentId, entry] of this.pool) {
        if (entry.state === 'starting' && (now - entry.startedAt) > 30_000) {
          this._destroyContainer(agentId);
        }
        if (entry.state === 'idle' && (now - entry.lastActiveAt) > IDLE_TIMEOUT_MS) {
          this._destroyContainer(agentId);
        }
      }
    }, 60_000);
  }

  markActive(agentId) {
    const entry = this.pool.get(agentId);
    if (entry) {
      entry.lastActiveAt = Date.now();
      entry.state = 'busy';
    }
  }

  markIdle(agentId) {
    const entry = this.pool.get(agentId);
    if (entry) {
      entry.state = 'idle';
      entry.ticketId = null;
    }
  }
}

module.exports = new PoolManager();
```

### `backend/src/api/pool.js` (CREATE)

```javascript
const express = require('express');
const router = express.Router();
const poolManager = require('../services/PoolManager');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');

router.post('/pool/request', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    const { project_id, repo_url, provider_config } = req.body;
    const result = await poolManager.requestAgent(project_id, repo_url, provider_config);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/pool/release', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    const { agent_id } = req.body;
    await poolManager.releaseAgent(agent_id);
    res.json({ success: true, data: { released: true } });
  } catch (err) { next(err); }
});

router.get('/pool/status', verifyToken, async (req, res, next) => {
  try {
    const status = poolManager.getStatus();
    res.json({ success: true, data: status });
  } catch (err) { next(err); }
});

module.exports = router;
```

### `backend/src/api/routes.js` (MODIFY)

Add after `const v1Routes = require('./v1');`:
```javascript
const poolRouter = require('./pool');
```

Add before catch-all:
```javascript
router.use(poolRouter);
```

### `agent/Dockerfile` (MODIFY — ensure standalone runs)

```dockerfile
FROM openjdk:17-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY target/vibecode-agent.jar app.jar

ENV BACKEND_URL=http://backend:3001
ENV REPO_CLONE_DIR=/repos
ENV API_KEY=changeme

CMD ["java", "-jar", "app.jar"]
```

## Test Plan

1. Ensure docker socket is accessible from the backend container
2. Build agent image: `cd agent && docker build -t vibecode-agent .`
3. Call `POST /api/pool/request` with a project_id
4. Verify container is created: `docker ps | grep agent-`
5. Call `GET /api/pool/status` — verify agent appears
6. Call `POST /api/pool/release` — verify container is removed
7. Test idle timeout: set AGENT_IDLE_TIMEOUT_MS=10000, wait 10s, verify container destroyed

## Rollback Steps

1. Remove dockerode from package.json
2. Delete PoolManager.js
3. Remove pool routes from routes.js
4. Remove docker socket bind mount from docker-compose.yml
