# bp-37: Deployment Pipeline — Environments, Webhook Trigger, Rollback — Implementation

**Status**: planned
**Priority**: P1
**Effort**: Medium
**Scope**: Both

## Purpose
Create deployment environments, trigger webhook-based deploys from done tickets, and support rollback.

## Implementation Order

1. **Create migrations 023 and 024** — environments + deployments tables
   - *Depends on*: nothing

2. **Create DeployService.js** — `backend/src/services/DeployService.js`
   - createEnvironment, listEnvironments, deleteEnvironment
   - triggerDeploy, rollbackDeployment, getDeploymentHistory, updateDeploymentStatus
   - *Depends on*: Step 1

3. **Create deployment validators** — `backend/src/validators/deployments.js`
   - Joi schemas for createEnvironment, triggerDeploy
   - *Depends on*: nothing

4. **Create deployment API routes** — `backend/src/api/deployments.js`
   - All deploy/environment CRUD endpoints
   - *Depends on*: Steps 2, 3

5. **Mount deployment routes** — `backend/src/api/v1/index.js`
   - Add deployment router
   - *Depends on*: Step 4

6. **Create frontend API client** — `frontend/src/api/deployments.js`
   - *Depends on*: Step 4

7. **Update ProjectDetail.vue** — add environments tab
   - List environments, create form, delete button
   - *Depends on*: Step 6

8. **Update PhaseFlow.vue** — add deploy button to done phase
   - Environment dropdown + deploy button
   - *Depends on*: Steps 6, 7

9. **Create DeployHistory.vue** — deployment history view
   - List of deployments with status badges, rollback buttons
   - *Depends on*: Step 6

## Per-File Action Plan

### `backend/src/migrations/023_environments.sql` (CREATE)

```sql
CREATE TABLE environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    webhook_url VARCHAR(512) NOT NULL,
    branch_pattern VARCHAR(128) DEFAULT '*',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_environments_project ON environments(project_id);
```

### `backend/src/migrations/024_deployments.sql` (CREATE)

```sql
CREATE TABLE deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id),
    environment_id UUID NOT NULL REFERENCES environments(id),
    status VARCHAR(16) DEFAULT 'pending',
    commit_sha VARCHAR(64),
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    rolled_back_at TIMESTAMPTZ,
    metadata JSONB
);

CREATE INDEX idx_deployments_ticket ON deployments(ticket_id);
CREATE INDEX idx_deployments_environment ON deployments(environment_id);
```

### `backend/src/services/DeployService.js` (CREATE)

```javascript
const db = require('../db');
const https = require('https');
const http = require('http');

async function createEnvironment(projectId, name, webhookUrl, branchPattern = '*') {
  const { rows } = await db.pool.query(
    `INSERT INTO environments (project_id, name, webhook_url, branch_pattern)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [projectId, name, webhookUrl, branchPattern]
  );
  return rows[0];
}

async function listEnvironments(projectId) {
  const { rows } = await db.pool.query(
    'SELECT * FROM environments WHERE project_id = $1 AND is_active = TRUE ORDER BY name',
    [projectId]
  );
  return rows;
}

async function deleteEnvironment(envId) {
  await db.pool.query('UPDATE environments SET is_active = FALSE WHERE id = $1', [envId]);
}

async function triggerDeploy(ticketId, environmentId, userId) {
  const ticket = await db.pool.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (ticket.rows.length === 0) throw new Error('Ticket not found');
  if (ticket.rows[0].status !== 'done' && ticket.rows[0].phase !== 'done') {
    throw new Error('Only done tickets can be deployed');
  }

  const env = await db.pool.query('SELECT * FROM environments WHERE id = $1', [environmentId]);
  if (env.rows.length === 0) throw new Error('Environment not found');

  const { rows } = await db.pool.query(
    `INSERT INTO deployments (ticket_id, environment_id, status, commit_sha, metadata)
     VALUES ($1, $2, 'pending', $3, $4) RETURNING *`,
    [ticketId, ticket.rows[0].commit_sha || null, JSON.stringify({ triggeredBy: userId })]
  );

  const deployment = rows[0];
  const payload = JSON.stringify({
    event: 'deploy',
    ticket_id: ticketId,
    ticket_title: ticket.rows[0].title,
    branch: ticket.rows[0].branch_name || 'main',
    commit_sha: ticket.rows[0].commit_sha,
    project_id: ticket.rows[0].project_id,
    environment: env.rows[0].name,
    environment_id: env.rows[0].id,
    deployment_id: deployment.id,
    timestamp: new Date().toISOString(),
  });

  try {
    await _sendWebhook(env.rows[0].webhook_url, payload);
    await db.pool.query("UPDATE deployments SET status = 'triggered' WHERE id = $1", [deployment.id]);
  } catch (err) {
    await db.pool.query(
      "UPDATE deployments SET status = 'failed', metadata = JSONB_SET(COALESCE(metadata, '{}'::jsonb), '{error}', $1) WHERE id = $2",
      [JSON.stringify(err.message), deployment.id]
    );
  }

  return deployment;
}

async function rollbackDeployment(deploymentId) {
  const dep = await db.pool.query('SELECT d.*, e.webhook_url, e.name as env_name FROM deployments d JOIN environments e ON d.environment_id = e.id WHERE d.id = $1', [deploymentId]);
  if (dep.rows.length === 0) throw new Error('Deployment not found');
  if (dep.rows[0].rolled_back_at) throw new Error('Deployment already rolled back');

  const payload = JSON.stringify({
    event: 'rollback',
    deployment_id: deploymentId,
    ticket_id: dep.rows[0].ticket_id,
    environment: dep.rows[0].env_name,
    timestamp: new Date().toISOString(),
  });

  await _sendWebhook(dep.rows[0].webhook_url, payload);
  await db.pool.query('UPDATE deployments SET rolled_back_at = NOW() WHERE id = $1', [deploymentId]);
}

async function getDeploymentHistory(ticketId, limit = 20, offset = 0) {
  const { rows } = await db.pool.query(
    `SELECT d.*, e.name as environment_name
     FROM deployments d JOIN environments e ON d.environment_id = e.id
     WHERE d.ticket_id = $1
     ORDER BY d.deployed_at DESC LIMIT $2 OFFSET $3`,
    [ticketId, limit, offset]
  );
  return rows;
}

async function updateDeploymentStatus(deploymentId, status) {
  const { rows } = await db.pool.query(
    'UPDATE deployments SET status = $1 WHERE id = $2 RETURNING *',
    [status, deploymentId]
  );
  return rows[0];
}

function _sendWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 10_000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout')); });
    req.write(payload);
    req.end();
  });
}

module.exports = { createEnvironment, listEnvironments, deleteEnvironment, triggerDeploy, rollbackDeployment, getDeploymentHistory, updateDeploymentStatus };
```

### `backend/src/api/deployments.js` (CREATE)

```javascript
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { createEnvironmentSchema } = require('../validators/deployments');
const DeployService = require('../services/DeployService');

router.get('/projects/:projectId/environments', verifyToken, async (req, res, next) => {
  try {
    const envs = await DeployService.listEnvironments(req.params.projectId);
    res.json({ success: true, data: envs });
  } catch (err) { next(err); }
});

router.post('/projects/:projectId/environments', verifyToken, requireAnyPermission('PROJECT_ADMIN'), validate(createEnvironmentSchema), async (req, res, next) => {
  try {
    const env = await DeployService.createEnvironment(req.params.projectId, req.body.name, req.body.webhook_url, req.body.branch_pattern);
    res.status(201).json({ success: true, data: env });
  } catch (err) { next(err); }
});

router.delete('/environments/:id', verifyToken, requireAnyPermission('PROJECT_ADMIN'), async (req, res, next) => {
  try {
    await DeployService.deleteEnvironment(req.params.id);
    res.json({ success: true, data: { deleted: true } });
  } catch (err) { next(err); }
});

router.post('/tickets/:ticketId/deploy', verifyToken, async (req, res, next) => {
  try {
    const dep = await DeployService.triggerDeploy(req.params.ticketId, req.body.environment_id, req.user.userId);
    res.json({ success: true, data: dep });
  } catch (err) { next(err); }
});

router.post('/deployments/:id/rollback', verifyToken, async (req, res, next) => {
  try {
    await DeployService.rollbackDeployment(req.params.id);
    res.json({ success: true, data: { rolled_back: true } });
  } catch (err) { next(err); }
});

router.patch('/deployments/:id/status', verifyToken, async (req, res, next) => {
  try {
    const dep = await DeployService.updateDeploymentStatus(req.params.id, req.body.status);
    res.json({ success: true, data: dep });
  } catch (err) { next(err); }
});

router.get('/tickets/:ticketId/deployments', verifyToken, async (req, res, next) => {
  try {
    const history = await DeployService.getDeploymentHistory(req.params.ticketId, req.query.limit, req.query.offset);
    res.json({ success: true, data: history });
  } catch (err) { next(err); }
});

module.exports = router;
```

### `frontend/src/api/deployments.js` (CREATE)

```typescript
import { get, post, del, patch } from './client'

export function listEnvironments(projectId: string) {
  return get(`/api/v1/projects/${projectId}/environments`)
}

export function createEnvironment(projectId: string, data: { name: string; webhook_url: string; branch_pattern?: string }) {
  return post(`/api/v1/projects/${projectId}/environments`, data)
}

export function deleteEnvironment(id: string) {
  return del(`/api/v1/environments/${id}`)
}

export function triggerDeploy(ticketId: string, environmentId: string) {
  return post(`/api/v1/tickets/${ticketId}/deploy`, { environment_id: environmentId })
}

export function rollbackDeployment(id: string) {
  return post(`/api/v1/deployments/${id}/rollback`)
}

export function getDeploymentHistory(ticketId: string, limit = 20, offset = 0) {
  return get(`/api/v1/tickets/${ticketId}/deployments?limit=${limit}&offset=${offset}`)
}

export function updateDeploymentStatus(id: string, status: string) {
  return patch(`/api/v1/deployments/${id}/status`, { status })
}
```

## Test Plan

1. Run migrations 023 and 024
2. Create an environment via API
3. Trigger deploy on a done ticket — verify webhook POST fires
4. Verify deployment record created with status 'triggered'
5. Rollback a deployment — verify second webhook fires
6. Manual status update via PATCH
7. Frontend: verify environments tab, deploy button, history view

## Rollback Steps

1. Run rollback for 024 then 023
2. Delete DeployService.js
3. Remove deploy routes from v1/index.js
4. Revert frontend changes
