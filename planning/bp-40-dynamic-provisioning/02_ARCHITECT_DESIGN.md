# bp-40: Dynamic Provisioning — Design

**Status**: planned
**Date created**: 2026-06-27
**Scope**: Backend

## Current State

- PoolManager.js (bp-36) manages agent containers exclusively on the local Docker daemon
- PoolManager.request() calls `docker.run('vibecode-agent', ...)` locally
- PoolManager.release() calls `docker.getContainer(id).stop()` + `.remove()` locally
- No concept of remote hosts exists

## Proposed Solution

### Database Schema

**Migration 027 — compute_nodes table**:
```sql
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
```

### Node Status State Machine

```
added → online ←→ offline (3 failures)
         ↓
      draining (manual) → offline → (manual re-activate) → online
```

Default status is `offline`. Admin activates via PUT, API sets `online`. Three SSH failures → auto → `offline`.

### PoolManager Extended Flow

```
PoolManager.request({ project_id, repo_url, provider_config })
  │
  ├─ 1. Check local Docker capacity
  │    └─ Has capacity? → spawn locally → return agent
  │
  ├─ 2. Query compute_nodes WHERE status='online' AND capacity > 0
  │    └─ No nodes? → throw "No capacity available"
  │
  ├─ 3. Score & rank nodes
  │    ├─ +5 if node.labels matches project labels
  │    ├─ +3 if node has existing agent with same repo
  │    ├─ +1 per remaining capacity slot
  │    └─ Pick highest score (random tie-break)
  │
  ├─ 4. ProvisioningService.spawnAgent(node, { repo_url, provider_config })
  │    ├─ SSH into node
  │    ├─ docker pull vibecode-agent (if needed)
  │    ├─ docker run -d --name agent-{id} --label repo={repo} vibecode-agent
  │    └─ Return containerId
  │
  └─ 5. Track mapping: agentId → nodeId (in-memory Map or heartbeats table)
```

### ProvisioningService Architecture

```javascript
class ProvisioningService {
  constructor() { this.ssh = new Client(); }

  async spawnAgent(node, env) {
    const key = await CredentialService.decryptKey(node.ssh_key_credential_id);
    const ssh = new Client();
    await ssh.connect({ host: node.hostname, port: node.ssh_port, username: node.ssh_user, privateKey: key });
    const cmd = `docker run -d --name agent-${env.id} ` +
      `-e BACKEND_URL=${env.backendUrl} ` +
      `-e PROJECT_ID=${env.projectId} ` +
      `-e API_KEY=${env.apiKey} ` +
      `vibecode-agent`;
    const { stdout } = await ssh.exec(cmd);
    ssh.end();
    return stdout.trim(); // container ID
  }

  async destroyAgent(node, containerId) {
    const key = await CredentialService.decryptKey(node.ssh_key_credential_id);
    const ssh = new Client();
    await ssh.connect({ host: node.hostname, ... });
    await ssh.exec(`docker stop ${containerId} && docker rm ${containerId}`);
    ssh.end();
  }

  async testConnection(node) {
    const key = await CredentialService.decryptKey(node.ssh_key_credential_id);
    const ssh = new Client();
    try {
      await ssh.connect({ host: node.hostname, port: node.ssh_port, username: node.ssh_user, privateKey: key, readyTimeout: 5000 });
      ssh.end();
      return true;
    } catch { return false; }
  }
}
```

### Host Scoring Algorithm

```javascript
function scoreNode(node, projectLabels, repoUrl) {
  let score = 0;
  // Label match: +5 per matching label
  const nodeLabels = new Set(Object.keys(node.labels || {}));
  for (const label of projectLabels) {
    if (nodeLabels.has(label)) score += 5;
  }
  // Capacity bonus: +1 per free slot
  const runningCount = getRunningCount(node.id); // from heartbeats or in-memory
  score += Math.max(0, node.capacity - runningCount);
  // Random tie-break (0-0.99)
  score += Math.random();
  return score;
}
```

### Error Handling

| Error | Handling |
|-------|----------|
| SSH connection refused | Retry once after 2s. If still fails → mark node offline, try next node |
| SSH auth failed | Mark node offline, log "SSH key rejected by {hostname}" |
| docker run fails (image not found) | Try `docker pull` then retry. If still fails → mark node degraded |
| docker run fails (port conflict) | Retry with different container name |
| Node offline | Skip in scoring, return to pool when re-activated by admin |

### Alternatives Considered

- **Option B: Kubernetes for remote nodes** — Too heavy for a homelab setup. SSH is simpler and universal.
- **Option C: WebSocket agent for remote workers** — Requires agent daemon on each remote machine. SSH is zero-install on the remote side.

## File-Level Impact Matrix

| File | Action | Specific Changes |
|------|--------|-----------------|
| `backend/src/migrations/027_compute_nodes.sql` | CREATE | compute_nodes table |
| `backend/src/services/ProvisioningService.js` | CREATE | SSH + Docker remote operations |
| `backend/src/services/PoolManager.js` | MODIFY | Add overflow logic to request()/release() |
| `backend/src/api/compute-nodes.js` | CREATE | CRUD endpoints for compute nodes |
| `backend/src/api/v1/index.js` | MODIFY | Mount compute-nodes router |
| `backend/src/services/CredentialService.js` | MODIFY | Add decryptKey() returning raw key text |
| `backend/package.json` | MODIFY | Add ssh2 dependency |
