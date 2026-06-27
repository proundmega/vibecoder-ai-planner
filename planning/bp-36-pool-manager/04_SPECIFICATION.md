# bp-36: Auto-Manage Agent Docker Containers (Pool Manager) — Spec

**Target model**: 14B (JavaScript)
**Date**: 2026-06-27

## File Operations

### MODIFY: `backend/package.json`

Add to `dependencies`:
```json
"dockerode": "^4.0.0"
```

Then run: `npm install dockerode`

### CREATE: `backend/src/services/PoolManager.js`

```javascript
const Docker = require('dockerode');
const crypto = require('crypto');

const DOCKER_SOCKET = process.env.DOCKER_SOCKET || '/var/run/docker.sock';
const AGENT_IMAGE = process.env.AGENT_IMAGE || 'vibecode-agent';
const BACKEND_URL = process.env.BACKEND_URL || 'http://backend:3001';
const IDLE_TIMEOUT_MS = parseInt(process.env.AGENT_IDLE_TIMEOUT_MS) || 300000;
const CONTAINER_NETWORK = process.env.CONTAINER_NETWORK || 'vibecode_default';
const REPO_VOLUME = process.env.REPO_VOLUME || 'vibecode_repos';

class PoolManager {
  constructor() {
    this.docker = new Docker({ socketPath: DOCKER_SOCKET });
    this.pool = new Map();
    this._startCleanupInterval();
  }

  _generateAgentId() {
    return crypto.randomBytes(8).toString('hex');
  }

  _generateApiKey() {
    return 'pool-' + crypto.randomBytes(24).toString('hex');
  }

  async requestAgent(projectId, repoUrl, providerConfig = {}) {
    for (const [id, entry] of this.pool) {
      if (entry.state === 'idle') {
        entry.state = 'busy';
        entry.projectId = projectId;
        entry.lastActiveAt = Date.now();
        return { agentId: id, containerId: entry.containerId, reused: true };
      }
    }

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
        Memory: 2 * 1024 * 1024 * 1024, // 2GB limit
      },
      AttachStdin: false,
      AttachStdout: false,
      AttachStderr: false,
      OpenStdin: false,
      StdinOnce: false,
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
      await entry.container.stop({ t: 5 });
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
        if (entry.state === 'starting' && (now - entry.startedAt) > 30000) {
          this._destroyContainer(agentId);
        }
        if (entry.state === 'idle' && (now - entry.lastActiveAt) > IDLE_TIMEOUT_MS) {
          this._destroyContainer(agentId);
        }
      }
    }, 60000);
  }

  markActive(agentId) {
    const entry = this.pool.get(agentId);
    if (entry) {
      entry.lastActiveAt = Date.now();
      if (entry.state === 'starting') entry.state = 'busy';
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

### CREATE: `backend/src/api/pool.js`

```javascript
const express = require('express');
const router = express.Router();
const poolManager = require('../services/PoolManager');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');

router.post('/pool/request', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    const { project_id, repo_url, provider_config } = req.body;
    if (!project_id) return res.status(400).json({ success: false, error: { message: 'project_id is required' } });
    const result = await poolManager.requestAgent(project_id, repo_url, provider_config);
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

router.post('/pool/release', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    const { agent_id } = req.body;
    if (!agent_id) return res.status(400).json({ success: false, error: { message: 'agent_id is required' } });
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

### MODIFY: `backend/src/api/routes.js`

Add require after `const cspReportRouter = require('./csp-report');`:
```javascript
const poolRouter = require('./pool');
```

Add before `// Catch-all`:
```javascript
router.use(poolRouter);
```

### MODIFY: `agent/Dockerfile`

```dockerfile
FROM openjdk:17-slim

WORKDIR /app

RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

COPY target/vibecode-agent.jar app.jar

ENV BACKEND_URL=http://backend:3001
ENV REPO_CLONE_DIR=/repos
ENV API_KEY=changeme

EXPOSE 8080

CMD ["java", "-jar", "app.jar"]
```

### MODIFY: `docker-compose.yml` (root)

Add to `backend` service:
```yaml
volumes:
  - /var/run/docker.sock:/var/run/docker.sock
  - vibecode_repos:/repos

environment:
  - DOCKER_SOCKET=/var/run/docker.sock
  - AGENT_IMAGE=vibecode-agent
  - CONTAINER_NETWORK=vibecode_default
  - REPO_VOLUME=vibecode_repos
```

Add to top-level `volumes`:
```yaml
volumes:
  vibecode_repos:
```

## Test Expectations

```
✓ POST /api/pool/request creates a Docker container running vibecode-agent
✓ Agent container receives correct environment variables
✓ POST /api/pool/release stops and removes the container
✓ GET /api/pool/status returns agent list with correct state
✓ Idle agent is destroyed after IDLE_TIMEOUT_MS
✓ Starting agent is destroyed if >30s without heartbeat
✓ Reusing an idle agent returns { reused: true } without spawning
```

## Edge Cases to Handle

1. **Docker daemon not available**: PoolManager constructor should not throw — wrap dockerode init in try/catch, set this.docker = null, and throw descriptive errors from methods
2. **Agent image not found**: docker.createContainer throws "image not found" — catch and throw with instruction to build the image first
3. **Container name collision**: unlikely with random agentId, but if it happens, dockerode throws "Conflict" — catch and retry with a different name
4. **Agent crashes on startup**: container starts but agent process exits. PoolManager won't know until heartbeat misses. Cleanup handles this (30s timeout for 'starting' state).
5. **Concurrent requestAgent calls**: JavaScript is single-threaded, but await means two calls can interleave. Both could find no idle agent and both spawn. Acceptable — extra agent will be cleaned up when idle.
