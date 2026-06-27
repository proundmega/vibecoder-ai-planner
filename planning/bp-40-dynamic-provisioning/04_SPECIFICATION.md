# bp-40: Dynamic Provisioning — Spec

**Target model**: 14B–34B (Express.js)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/027_compute_nodes.sql`
```sql
-- Migration: 027_compute_nodes.sql
CREATE TABLE IF NOT EXISTS compute_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname VARCHAR(256) NOT NULL,
  ssh_port INTEGER DEFAULT 22,
  ssh_user VARCHAR(64) NOT NULL,
  ssh_key_credential_id UUID NOT NULL REFERENCES project_credentials(id),
  labels JSONB DEFAULT '{}',
  capacity INTEGER DEFAULT 1 NOT NULL CHECK (capacity > 0),
  status VARCHAR(16) DEFAULT 'offline' CHECK (status IN ('online', 'offline', 'draining', 'degraded')),
  failure_count INTEGER DEFAULT 0,
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hostname)
);

CREATE INDEX idx_compute_nodes_status ON compute_nodes(status);

COMMENT ON TABLE compute_nodes IS 'Remote Docker hosts for agent provisioning via SSH';
```

### CREATE: `backend/src/services/ProvisioningService.js`

**Full implementation**:

```javascript
const { Client } = require('ssh2');
const { pool } = require('../db');
const CredentialService = require('./CredentialService');
const { UtilityError } = require('../errors/HttpError');

class ProvisioningService {

  async getNode(id) {
    const result = await pool.query('SELECT * FROM compute_nodes WHERE id = $1', [id]);
    if (result.rows.length === 0) throw new UtilityError('Compute node not found', 404);
    return result.rows[0];
  }

  async getKey(node) {
    return await CredentialService.decryptKey(node.ssh_key_credential_id);
  }

  async connect(node, key) {
    const ssh = new Client();
    await new Promise((resolve, reject) => {
      ssh.on('ready', resolve);
      ssh.on('error', reject);
      ssh.connect({
        host: node.hostname,
        port: node.ssh_port || 22,
        username: node.ssh_user,
        privateKey: key,
        readyTimeout: 10000,
      });
    });
    return ssh;
  }

  async exec(ssh, command) {
    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      ssh.exec(command, (err, stream) => {
        if (err) { ssh.end(); reject(err); return; }
        stream.on('data', (data) => { stdout += data.toString(); });
        stream.stderr.on('data', (data) => { stderr += data.toString(); });
        stream.on('close', (code) => {
          ssh.end();
          resolve({ stdout, stderr, exitCode: code });
        });
      });
    });
  }

  async spawnAgent(nodeId, env) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    const ssh = await this.connect(node, key);

    const envFlags = Object.entries(env)
      .map(([k, v]) => `-e ${k}=${v}`)
      .join(' ');

    const cmd = `docker run -d --name agent-${env.id} ` +
      `--restart unless-stopped ` +
      `${envFlags} ` +
      `vibecode-agent:latest`;

    const { stdout, stderr, exitCode } = await this.exec(ssh, cmd);

    await pool.query(
      'UPDATE compute_nodes SET last_seen = NOW(), failure_count = 0 WHERE id = $1',
      [nodeId]
    );

    if (exitCode !== 0) {
      if (stderr.includes('pull access denied') || stderr.includes('not found')) {
        logger.info('Pulling image on %s...', node.hostname);
        await this.exec(ssh, 'docker pull vibecode-agent:latest');
        const retry = await this.exec(ssh, cmd);
        if (retry.exitCode !== 0) throw new Error(`docker run failed on ${node.hostname}: ${retry.stderr}`);
        return retry.stdout.trim();
      }
      throw new Error(`docker run failed on ${node.hostname}: ${stderr}`);
    }

    return stdout.trim();
  }

  async destroyAgent(nodeId, containerId) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    const ssh = await this.connect(node, key);
    await this.exec(ssh, `docker stop ${containerId} && docker rm ${containerId}`);
  }

  async testConnection(nodeId) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    let ssh;
    try {
      ssh = await this.connect(node, key);
      await this.exec(ssh, 'docker info');
      await pool.query(
        'UPDATE compute_nodes SET status = $1, failure_count = 0, last_seen = NOW() WHERE id = $2',
        ['online', nodeId]
      );
      return { success: true };
    } catch (err) {
      const newCount = (node.failure_count || 0) + 1;
      const newStatus = newCount >= 3 ? 'offline' : 'degraded';
      await pool.query(
        'UPDATE compute_nodes SET status = $1, failure_count = $2, last_seen = NOW() WHERE id = $3',
        [newStatus, newCount, nodeId]
      );
      return { success: false, error: err.message, failureCount: newCount };
    } finally {
      if (ssh) try { ssh.end(); } catch { /* ignore */ }
    }
  }

  async getRunningContainers(nodeId) {
    const node = await this.getNode(nodeId);
    const key = await this.getKey(node);
    const ssh = await this.connect(node, key);
    const { stdout } = await this.exec(ssh, `docker ps --filter "name=agent-" --format "{{.ID}} {{.Names}}"`);
    return stdout.trim().split('\n').filter(Boolean).map(line => {
      const [id, ...nameParts] = line.split(' ');
      return { id, name: nameParts.join(' ') };
    });
  }
}

module.exports = new ProvisioningService();
```

### CREATE: `backend/src/api/compute-nodes.js`

**Routes** (full):
```javascript
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { pool } = require('../db');
const provisioning = require('../services/ProvisioningService');
const CredentialService = require('../services/CredentialService');

// GET /api/v1/compute-nodes
router.get('/', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, next) => {
  const result = await pool.query('SELECT * FROM compute_nodes ORDER BY hostname');
  res.json({ success: true, data: result.rows });
});

// POST /api/v1/compute-nodes
router.post('/', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, next) => {
  const { hostname, ssh_port, ssh_user, ssh_key_credential_id, labels, capacity } = req.body;
  if (!hostname || !ssh_user || !ssh_key_credential_id) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'hostname, ssh_user, and ssh_key_credential_id are required' } });
  }
  const result = await pool.query(
    `INSERT INTO compute_nodes (hostname, ssh_port, ssh_user, ssh_key_credential_id, labels, capacity)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [hostname, ssh_port || 22, ssh_user, ssh_key_credential_id, labels || '{}', capacity || 1]
  );
  res.status(201).json({ success: true, data: result.rows[0] });
});

// PUT /api/v1/compute-nodes/:id
router.put('/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, next) => {
  const { hostname, ssh_port, ssh_user, ssh_key_credential_id, labels, capacity, status } = req.body;
  const sets = []; const vals = []; let idx = 1;
  if (hostname !== undefined) { sets.push('hostname=$' + idx++); vals.push(hostname); }
  if (ssh_port !== undefined) { sets.push('ssh_port=$' + idx++); vals.push(ssh_port); }
  if (ssh_user !== undefined) { sets.push('ssh_user=$' + idx++); vals.push(ssh_user); }
  if (ssh_key_credential_id !== undefined) { sets.push('ssh_key_credential_id=$' + idx++); vals.push(ssh_key_credential_id); }
  if (labels !== undefined) { sets.push('labels=$' + idx++); vals.push(JSON.stringify(labels)); }
  if (capacity !== undefined) { sets.push('capacity=$' + idx++); vals.push(capacity); }
  if (status !== undefined) { sets.push('status=$' + idx++); vals.push(status); }
  if (sets.length === 0) return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'No fields provided' } });
  vals.push(req.params.id);
  const result = await pool.query(`UPDATE compute_nodes SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`, vals);
  if (result.rows.length === 0) return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Node not found' } });
  res.json({ success: true, data: result.rows[0] });
});

// DELETE /api/v1/compute-nodes/:id
router.delete('/:id', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, next) => {
  await pool.query('DELETE FROM compute_nodes WHERE id = $1', [req.params.id]);
  res.json({ success: true, data: null });
});

// POST /api/v1/compute-nodes/:id/test
router.post('/:id/test', verifyToken, requireAnyPermission('PROJECT_UPDATE'), async (req, res, next) => {
  const result = await provisioning.testConnection(req.params.id);
  res.json({ success: result.success, data: result });
});

module.exports = router;
```

### MODIFY: `backend/src/services/CredentialService.js`

**Add method**:
```javascript
static async decryptKey(credentialId) {
  const result = await pool.query(
    'SELECT key_encrypted FROM project_credentials WHERE id = $1',
    [credentialId]
  );
  if (result.rows.length === 0) {
    throw new NotFoundError('Credential not found');
  }
  return decrypt(result.rows[0].key_encrypted);
}
```

### MODIFY: `backend/src/services/PoolManager.js`

**Add to constructor**:
```javascript
this.provisioning = require('./ProvisioningService');
this.nodeMappings = new Map(); // agentId → nodeId
```

**Modified request()**:
```javascript
async request(projectConfig) {
  // Try local first
  try {
    const localContainer = await this._spawnLocal(projectConfig);
    return { containerId: localContainer.id, nodeId: null, hostname: 'local' };
  } catch (localErr) {
    logger.warn('Local capacity full or unavailable: %s', localErr.message);
  }

  // Find online nodes
  const nodesResult = await pool.query(
    'SELECT * FROM compute_nodes WHERE status = $1 AND capacity > 0 ORDER BY capacity DESC',
    ['online']
  );
  if (nodesResult.rows.length === 0) {
    throw new Error('No compute capacity available locally or remotely');
  }

  // Score nodes
  const scoredNodes = nodesResult.rows.map(node => ({
    node,
    mappingCount: this._getRunningOnNode(node.id),
    score: this._scoreNode(node, projectConfig),
  }));
  scoredNodes.sort((a, b) => b.score - a.score);

  // Try nodes in order
  for (const { node } of scoredNodes) {
    try {
      const containerId = await this.provisioning.spawnAgent(node.id, projectConfig);
      this.nodeMappings.set(containerId, node.id);
      return { containerId, nodeId: node.id, hostname: node.hostname };
    } catch (err) {
      logger.error('Failed to spawn on node %s: %s', node.hostname, err.message);
      continue;
    }
  }

  throw new Error('Failed to spawn agent on any available compute node');
}
```

**Modified release()**:
```javascript
async release(agentId) {
  const nodeId = this.nodeMappings.get(agentId);
  if (nodeId) {
    try {
      await this.provisioning.destroyAgent(nodeId, agentId);
    } catch (err) {
      logger.error('Failed to destroy agent %s on node %s: %s', agentId, nodeId, err.message);
    }
    this.nodeMappings.delete(agentId);
  } else {
    // Local container
    try {
      const container = docker.getContainer(agentId);
      await container.stop();
      await container.remove();
    } catch (err) {
      logger.error('Failed to stop local container %s: %s', agentId, err.message);
    }
  }
}
```

**New helper methods**:
```javascript
_scoreNode(node, projectConfig) {
  let score = 0;
  const nodeLabels = node.labels || {};
  const projectLabels = projectConfig.labels || [];
  for (const label of projectLabels) {
    if (nodeLabels[label]) score += 5;
  }
  const running = this._getRunningOnNode(node.id);
  const free = node.capacity - running;
  score += Math.max(0, free);
  score += Math.random(); // tie-break
  return score;
}

_getRunningOnNode(nodeId) {
  let count = 0;
  for (const nid of this.nodeMappings.values()) {
    if (nid === nodeId) count++;
  }
  return count;
}
```

## Test Expectations

### Unit/Integration
```
✓ Create compute node → 201, stored in DB with status='offline'
✓ Test connection with valid SSH key → status='online'
✓ Test connection with invalid SSH key → status='degraded', failure_count=1
✓ Test connection failure 3x → status='offline'
✓ Pool request with full local → spawns on remote node
✓ Pool release → docker stop+rm on remote node
✓ Node scoring prefers label matches
✓ Node scoring caps at capacity
✓ Delete node → removed from rotation
```

## Edge Cases to Handle

1. **SSH key file permissions**: ssh2 reads key as string, no temp file needed — avoids permission issues
2. **Node with capacity=0**: Excluded from query (WHERE capacity > 0)
3. **Concurrent requests to same node**: _getRunningOnNode tracks in-memory; could be off if agent count changes externally. Acceptable.
4. **Docker not installed on remote**: `docker info` in testConnection catches this → node stays offline
5. **SSH port non-standard**: Stored in ssh_port column, default 22
6. **Remote node goes offline mid-session**: Agent heartbeat fails → agent released (bp-33) → release tries remote cleanup → SSH fails → logged, agent orphaned
7. **Credential deleted while node references it**: decryptKey fails → node becomes unreachable → admin must update credential

## Existing Code Patterns to Follow

- snake_case in DB, camelCase in API responses
- Express router pattern with verifyToken + requireAnyPermission
- Response format: `{ success, data }` or `{ success, error: { code, message } }`
- Static methods for service classes, direct exports for singletons
- `require('../utils/logger')` for logging
- `require('../errors/HttpError')` for errors
