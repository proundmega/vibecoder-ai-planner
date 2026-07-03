const db = require('../db');
const logger = require('../utils/logger');

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
  if (parsed.protocol === 'http:') {
    logger.warn('Webhook sent over HTTP (unencrypted): ' + url);
  }
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
