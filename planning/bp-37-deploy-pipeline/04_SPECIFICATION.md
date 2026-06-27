# bp-37: Deployment Pipeline — Environments, Webhook Trigger, Rollback — Spec

**Target model**: 14B (TypeScript + JavaScript)
**Date**: 2026-06-27

## File Operations

### CREATE: `backend/src/migrations/023_environments.sql`

```sql
CREATE TABLE IF NOT EXISTS environments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name VARCHAR(64) NOT NULL,
    webhook_url VARCHAR(512) NOT NULL,
    branch_pattern VARCHAR(128) DEFAULT '*',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
```

### CREATE: `backend/src/migrations/023_environments_rollback.sql`

```sql
DROP TABLE IF EXISTS environments;
```

### CREATE: `backend/src/migrations/024_deployments.sql`

```sql
CREATE TABLE IF NOT EXISTS deployments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID NOT NULL REFERENCES tickets(id),
    environment_id UUID NOT NULL REFERENCES environments(id),
    status VARCHAR(16) DEFAULT 'pending',
    commit_sha VARCHAR(64),
    deployed_at TIMESTAMPTZ DEFAULT NOW(),
    rolled_back_at TIMESTAMPTZ,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_deployments_ticket ON deployments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_deployments_environment ON deployments(environment_id);
```

### CREATE: `backend/src/migrations/024_deployments_rollback.sql`

```sql
DROP TABLE IF EXISTS deployments;
```

### MODIFY: `backend/src/migrations/apply.js`

Add to SQL_FILES after the last entry:
```javascript
path.join(__dirname, './023_environments.sql'),
path.join(__dirname, './024_deployments.sql'),
```

### CREATE: `backend/src/validators/deployments.js`

```javascript
const Joi = require('joi');

const createEnvironmentSchema = Joi.object({
  name: Joi.string().min(1).max(64).required().messages({
    'string.empty': 'Environment name is required',
    'string.max': 'Environment name must not exceed 64 characters',
  }),
  webhook_url: Joi.string().uri().max(512).required().messages({
    'string.uri': 'Webhook URL must be a valid URL',
    'any.required': 'Webhook URL is required',
  }),
  branch_pattern: Joi.string().max(128).optional().default('*'),
});

const triggerDeploySchema = Joi.object({
  environment_id: Joi.string().uuid().required().messages({
    'string.guid': 'Environment ID must be a valid UUID',
    'any.required': 'Environment ID is required',
  }),
});

const updateDeploymentStatusSchema = Joi.object({
  status: Joi.string().valid('success', 'failed', 'triggered').required(),
});

module.exports = { createEnvironmentSchema, triggerDeploySchema, updateDeploymentStatusSchema };
```

### CREATE: `backend/src/services/DeployService.js`

```javascript
const db = require('../db');

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
  const { rowCount } = await db.pool.query(
    'UPDATE environments SET is_active = FALSE WHERE id = $1',
    [envId]
  );
  if (rowCount === 0) throw new Error('Environment not found');
}

async function triggerDeploy(ticketId, environmentId) {
  const ticketRes = await db.pool.query('SELECT * FROM tickets WHERE id = $1', [ticketId]);
  if (ticketRes.rows.length === 0) throw new Error('Ticket not found');
  const ticket = ticketRes.rows[0];

  if (ticket.status !== 'done' && ticket.phase !== 'done') {
    throw new Error('Only tickets in done phase can be deployed');
  }

  const envRes = await db.pool.query('SELECT * FROM environments WHERE id = $1 AND is_active = TRUE', [environmentId]);
  if (envRes.rows.length === 0) throw new Error('Environment not found');
  const env = envRes.rows[0];

  const { rows } = await db.pool.query(
    `INSERT INTO deployments (ticket_id, environment_id, commit_sha)
     VALUES ($1, $2, $3) RETURNING *`,
    [ticketId, environmentId, ticket.commit_sha || null]
  );
  const deployment = rows[0];

  const payload = {
    event: 'deploy',
    ticket_id: ticketId,
    ticket_title: ticket.title,
    branch: ticket.branch_name || 'main',
    commit_sha: ticket.commit_sha,
    project_id: ticket.project_id,
    environment: env.name,
    environment_id: env.id,
    deployment_id: deployment.id,
    timestamp: new Date().toISOString(),
  };

  try {
    await _sendWebhook(env.webhook_url, payload);
    await db.pool.query("UPDATE deployments SET status = 'triggered' WHERE id = $1", [deployment.id]);
  } catch (err) {
    await db.pool.query(
      `UPDATE deployments SET status = 'failed', metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{error}', $1) WHERE id = $2`,
      [JSON.stringify(err.message), deployment.id]
    );
  }

  return { ...deployment, environment_name: env.name };
}

async function rollbackDeployment(deploymentId) {
  const depRes = await db.pool.query(
    `SELECT d.*, e.webhook_url, e.name as environment_name
     FROM deployments d JOIN environments e ON d.environment_id = e.id
     WHERE d.id = $1`,
    [deploymentId]
  );
  if (depRes.rows.length === 0) throw new Error('Deployment not found');
  const dep = depRes.rows[0];
  if (dep.rolled_back_at) throw new Error('Deployment already rolled back');

  const payload = {
    event: 'rollback',
    deployment_id: deploymentId,
    ticket_id: dep.ticket_id,
    environment: dep.environment_name,
    timestamp: new Date().toISOString(),
  };

  await _sendWebhook(dep.webhook_url, payload);
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
  if (rows.length === 0) throw new Error('Deployment not found');
  return rows[0];
}

async function _sendWebhook(url, payload) {
  const body = JSON.stringify(payload);
  const parsed = new URL(url);
  const mod = parsed.protocol === 'https:' ? require('https') : require('http');
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'Vibecode-Deploy/1.0',
      },
      timeout: 10000,
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Webhook timeout after 10s')); });
    req.write(body);
    req.end();
  });
}

module.exports = {
  createEnvironment, listEnvironments, deleteEnvironment,
  triggerDeploy, rollbackDeployment, getDeploymentHistory, updateDeploymentStatus,
};
```

### CREATE: `backend/src/api/deployments.js`

```javascript
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { createEnvironmentSchema, triggerDeploySchema, updateDeploymentStatusSchema } = require('../validators/deployments');
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

router.post('/tickets/:ticketId/deploy', verifyToken, validate(triggerDeploySchema), async (req, res, next) => {
  try {
    const dep = await DeployService.triggerDeploy(req.params.ticketId, req.body.environment_id);
    res.json({ success: true, data: dep });
  } catch (err) { next(err); }
});

router.post('/deployments/:id/rollback', verifyToken, async (req, res, next) => {
  try {
    await DeployService.rollbackDeployment(req.params.id);
    res.json({ success: true, data: { rolled_back: true } });
  } catch (err) { next(err); }
});

router.patch('/deployments/:id/status', verifyToken, validate(updateDeploymentStatusSchema), async (req, res, next) => {
  try {
    const dep = await DeployService.updateDeploymentStatus(req.params.id, req.body.status);
    res.json({ success: true, data: dep });
  } catch (err) { next(err); }
});

router.get('/tickets/:ticketId/deployments', verifyToken, async (req, res, next) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;
    const history = await DeployService.getDeploymentHistory(req.params.ticketId, limit, offset);
    res.json({ success: true, data: history });
  } catch (err) { next(err); }
});

module.exports = router;
```

### MODIFY: `backend/src/api/v1/index.js`

Add require:
```javascript
const deployRouter = require('../deployments');
```

Add mount:
```javascript
router.use(deployRouter);
```

### CREATE: `frontend/src/api/deployments.js`

```typescript
import { get, post, del, patch } from './client'

export interface Environment {
  id: string
  project_id: string
  name: string
  webhook_url: string
  branch_pattern: string
  is_active: boolean
  created_at: string
}

export interface Deployment {
  id: string
  ticket_id: string
  environment_id: string
  environment_name?: string
  status: 'pending' | 'triggered' | 'success' | 'failed'
  commit_sha: string | null
  deployed_at: string
  rolled_back_at: string | null
  metadata: Record<string, any> | null
}

export function listEnvironments(projectId: string): Promise<Environment[]> {
  return get(`/api/v1/projects/${projectId}/environments`)
}

export function createEnvironment(projectId: string, data: { name: string; webhook_url: string; branch_pattern?: string }): Promise<Environment> {
  return post(`/api/v1/projects/${projectId}/environments`, data)
}

export function deleteEnvironment(id: string): Promise<void> {
  return del(`/api/v1/environments/${id}`)
}

export function triggerDeploy(ticketId: string, environmentId: string): Promise<Deployment> {
  return post(`/api/v1/tickets/${ticketId}/deploy`, { environment_id: environmentId })
}

export function rollbackDeployment(id: string): Promise<void> {
  return post(`/api/v1/deployments/${id}/rollback`)
}

export function getDeploymentHistory(ticketId: string, limit = 20, offset = 0): Promise<Deployment[]> {
  return get(`/api/v1/tickets/${ticketId}/deployments?limit=${limit}&offset=${offset}`)
}

export function updateDeploymentStatus(id: string, status: string): Promise<Deployment> {
  return patch(`/api/v1/deployments/${id}/status`, { status })
}
```

## Test Expectations

```
✓ Migration 023 creates environments table
✓ Migration 024 creates deployments table
✓ Create environment with valid data returns 201
✓ List environments returns environments for a project
✓ Delete environment sets is_active = false
✓ Trigger deploy on done ticket creates deployment + fires webhook
✓ Trigger deploy on non-done ticket throws 400
✓ Rollback fires webhook with event: rollback
✓ Get deployment history returns paginated results
✓ Manual status update via PATCH works
```

## Edge Cases to Handle

1. **Webhook URL unreachable**: caught by timeout (10s), deployment status set to 'failed', error stored in metadata.error
2. **Already rolled back**: rollback throws "Deployment already rolled back"
3. **Environment deleted**: triggerDeploy returns "Environment not found" (checks is_active)
4. **Ticket not done**: triggerDeploy throws "Only tickets in done phase can be deployed"
5. **Large deployment history**: default limit 20, max 100, offset for pagination
6. **Webhook returns non-200**: still considered 'triggered' — deployment may succeed or fail downstream. User can manually update status via PATCH.
