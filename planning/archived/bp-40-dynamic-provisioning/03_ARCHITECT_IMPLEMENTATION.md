# bp-40: Dynamic Provisioning — Implementation

**Status**: planned
**Priority**: P2
**Effort**: Large
**Scope**: Backend

## Purpose
Extend PoolManager to overflow agent containers to remote machines via SSH when local Docker is saturated.

## Implementation Order

1. **Install ssh2** — `npm install ssh2`
2. **Migration 027** — Create compute_nodes table
3. **Create ProvisioningService.js** — SSH + Docker operations
4. **Modify CredentialService.js** — Add decryptKey() method
5. **Create compute-nodes.js API** — CRUD endpoints for nodes
6. **Modify v1/index.js** — Mount compute-nodes router
7. **Modify PoolManager.js** — Add cross-machine logic
8. **Modify pool.js API** — Extend with compute node info

## Per-File Action Plan

### `backend/src/migrations/027_compute_nodes.sql` (CREATE)
```sql
-- Migration: 027_compute_nodes.sql
CREATE TABLE compute_nodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname VARCHAR(256) NOT NULL,
  ssh_port INTEGER DEFAULT 22,
  ssh_user VARCHAR(64) NOT NULL,
  ssh_key_credential_id UUID NOT NULL REFERENCES project_credentials(id),
  labels JSONB DEFAULT '{}',
  capacity INTEGER DEFAULT 1,
  status VARCHAR(16) DEFAULT 'offline',
  last_seen TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(hostname)
);

CREATE INDEX idx_compute_nodes_status ON compute_nodes(status);
```

### `backend/src/services/ProvisioningService.js` (CREATE)

**Imports**:
```javascript
const { Client } = require('ssh2');
const { pool } = require('../db');
const CredentialService = require('./CredentialService');
const logger = require('../utils/logger');
```

**Class**: `ProvisioningService`

**Methods**:
```javascript
async spawnAgent(nodeId, agentConfig)
  - 1. Get node from DB: SELECT * FROM compute_nodes WHERE id = $1
  - 2. Decrypt SSH key: CredentialService.decryptKey(node.ssh_key_credential_id)
  - 3. Connect via ssh2: { host, port, username, privateKey }
  - 4. Build docker run command with env vars from agentConfig
  - 5. ssh.exec(cmd)
  - 6. If stderr contains "pull access denied" → attempt docker pull first, retry
  - 7. Return containerId from stdout
  - 8. ssh.end()
  - 9. Update node last_seen

async destroyAgent(nodeId, containerId)
  - 1. Same SSH connection flow
  - 2. ssh.exec(`docker stop ${containerId} && docker rm ${containerId}`)
  - 3. ssh.end()

async testConnection(nodeId)
  - 1. Get node + decrypt key
  - 2. Try SSH connect with 5s timeout
  - 3. On success: update status='online', last_seen=NOW()
  - 4. On failure: increment failure_count, if >= 3 set status='offline'

async getRunningContainers(nodeId)
  - 1. SSH into node
  - 2. ssh.exec(`docker ps --filter "name=agent-" --format "{{.ID}}"`)
  - 3. Return array of container IDs
  - 4. ssh.end()

async executeCommand(nodeId, command)
  - 1. Reusable: SSH connect → exec → return stdout/stderr/exitCode
  - 2. Used by testConnection, spawnAgent, destroyAgent
```

### `backend/src/services/CredentialService.js` (MODIFY)

Add method:
```javascript
static async decryptKey(credentialId) {
  const result = await pool.query(
    'SELECT key_encrypted FROM project_credentials WHERE id = $1',
    [credentialId]
  );
  if (result.rows.length === 0) throw new NotFoundError('Credential not found');
  return decrypt(result.rows[0].key_encrypted);
}
```

### `backend/src/api/compute-nodes.js` (CREATE)

Routes:
```
GET    /api/v1/compute-nodes              → list all nodes
POST   /api/v1/compute-nodes              → add a node
GET    /api/v1/compute-nodes/:id          → get node detail
PUT    /api/v1/compute-nodes/:id          → update node
DELETE /api/v1/compute-nodes/:id          → delete node
POST   /api/v1/compute-nodes/:id/test     → test SSH connection
```

All routes require `verifyToken` middleware and `requireAnyPermission('SUPER_ADMIN')`.

### `backend/src/services/PoolManager.js` (MODIFY)

**Modified `request()` flow**:
```javascript
async request(projectConfig) {
  // 1. Try local Docker
  try {
    return await this._spawnLocal(projectConfig);
  } catch (localErr) {
    logger.warn('Local Docker unavailable/at capacity: %s', localErr.message);
  }

  // 2. Try remote nodes
  const nodes = await pool.query(
    'SELECT * FROM compute_nodes WHERE status = $1 AND capacity > 0 ORDER BY capacity DESC',
    ['online']
  );
  if (nodes.rows.length === 0) throw new Error('No compute capacity available');

  // 3. Score and pick best node
  const scored = await this._scoreNodes(nodes.rows, projectConfig);
  const best = scored[0];

  // 4. Spawn on remote
  const containerId = await provisioningService.spawnAgent(best.id, projectConfig);
  
  // 5. Track the mapping
  this._trackMapping(containerId, best.id);
  
  return { containerId, nodeId: best.id, hostname: best.hostname };
}
```

**Modified `release()` flow**:
```javascript
async release(agentId) {
  const mapping = this._getMapping(agentId);
  if (mapping && mapping.nodeId) {
    await provisioningService.destroyAgent(mapping.nodeId, agentId);
    this._removeMapping(agentId);
  } else {
    // Local container
    const container = docker.getContainer(agentId);
    await container.stop();
    await container.remove();
  }
}
```

### `backend/src/api/pool.js` (MODIFY)

Add endpoints:
```
GET    /api/v1/pool/nodes                → list nodes and their running agent counts
GET    /api/v1/pool/nodes/:id/containers → list containers on a specific node
```

## Migration Plan
Migration 027 applied after bp-36/bp-37 migrations.

## Test Plan
1. Add a compute node via API → verify stored in DB
2. Test SSH connection → verify status changes to online
3. Fill local Docker capacity (mock) → verify overflow to remote
4. Release remote agent → verify docker stop + rm on remote
5. Set node to offline → verify no requests routed to it
6. SSH failure 3x → verify auto-offline
7. Test with invalid SSH key → proper error message

## Rollback Steps
1. Run 027_rollback.sql: DROP TABLE compute_nodes
2. Revert PoolManager.js changes
3. Remove ProvisioningService.js
4. Remove compute-nodes.js API
5. `npm uninstall ssh2`
