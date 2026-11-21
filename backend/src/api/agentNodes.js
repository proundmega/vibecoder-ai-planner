const express = require('express');
const { pool } = require('../db');
const { decrypt } = require('../utils/crypto');
const AgentNodeService = require('../services/AgentNodeService');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { agentNodeAuth, bindNode } = require('../middleware/agentNodeAuth');
const { agentRuntimeAuth } = require('../middleware/agentRuntimeAuth');
const {
  loadNode,
  requireNodeOwner,
  requireProjectAdmin,
  requireGrantProjectAdmin,
} = require('../middleware/agentNodeAccess');
const {
  enrollSchema,
  refreshSchema,
  mintSchema,
  grantSchema,
  declareRuntimesSchema,
  heartbeatSchema,
  runtimePatchSchema,
} = require('../validators/agentFleet');
const { enrollmentEnabled, requireSecureTransport } = require('./agentEnrollmentGate');
const agentEnrollmentRateLimit = require('../middleware/agentEnrollmentRateLimit');

const router = express.Router();

function errorBody(code, message) {
  return { success: false, error: { code, message } };
}

function fail(res, error) {
  const status = error.status || 500;
  return res
    .status(status)
    .json(errorBody(error.code || 'INTERNAL_SERVER_ERROR', error.message || 'Request failed'));
}

// Gate only the node/admin surface; this router is mounted at the app root so
// an unscoped `router.use` would 404 unrelated routes.
router.use('/agent-nodes', (req, res, next) => {
  if (!enrollmentEnabled()) return res.status(404).json(errorBody('NOT_FOUND', 'Not found'));
  next();
});

// ---------------------------------------------------------------------------
// Enrollment and credentials (bearer secrets; TLS required outside tests)
// ---------------------------------------------------------------------------

router.post(
  '/agent-nodes/enroll',
  agentEnrollmentRateLimit({ max: 10, windowMs: 60 * 1000, scope: 'node-enroll' }),
  requireSecureTransport,
  validate(enrollSchema), async (req, res, next) => {
  try {
    const data = await AgentNodeService.enroll({
      token: req.body.token,
      name: req.body.name,
      hostname: req.body.hostname || null,
      fingerprint: req.body.fingerprint || null,
      ip: req.ip,
    });
    res.status(201).json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

router.post(
  '/agent-nodes/refresh',
  agentEnrollmentRateLimit({ max: 30, windowMs: 60 * 1000, scope: 'node-refresh' }),
  requireSecureTransport,
  validate(refreshSchema), async (req, res, next) => {
  try {
    const data = await AgentNodeService.refresh({
      token: req.body.refresh_token,
      idempotencyKey: req.body.idempotency_key || null,
      ip: req.ip,
    });
    res.json({ success: true, data });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

// ---------------------------------------------------------------------------
// Admin (JWT) — owner-scoped
// ---------------------------------------------------------------------------

router.get('/agent-nodes', verifyToken, requireAnyPermission('AGENT_READ'), async (req, res, next) => {
  try {
    const nodes = await AgentNodeService.listNodes(req.user);
    res.json({ success: true, data: nodes });
  } catch (error) {
    if (error.status) return fail(res, error);
    next(error);
  }
});

router.post(
  '/agent-nodes',
  verifyToken,
  requireAnyPermission('AGENT_CREATE'),
  validate(mintSchema),
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.mint({
        ownerId: req.user.userId,
        name: req.body.name,
        ttlSeconds: req.body.ttl_seconds,
        maxUses: req.body.max_uses,
        createdBy: req.user.userId,
        ip: req.ip,
      });
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.get(
  '/agent-nodes/:id',
  verifyToken,
  requireAnyPermission('AGENT_READ'),
  loadNode,
  async (req, res) => {
    res.json({ success: true, data: req.nodeRecord });
  }
);

router.post(
  '/agent-nodes/:id/revoke',
  verifyToken,
  requireAnyPermission('AGENT_REVOKE'),
  loadNode,
  requireNodeOwner,
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.revoke(req.nodeRecord.id, {
        actorId: req.user.userId,
        ip: req.ip,
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.post(
  '/agent-nodes/:id/drain',
  verifyToken,
  requireAnyPermission('AGENT_REVOKE'),
  loadNode,
  requireNodeOwner,
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.drain(req.nodeRecord.id, {
        actorId: req.user.userId,
        ip: req.ip,
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.get(
  '/agent-nodes/:id/grants',
  verifyToken,
  requireAnyPermission('AGENT_READ'),
  loadNode,
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.listGrants(req.nodeRecord.id, req.user);
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.post(
  '/agent-nodes/:id/grants',
  verifyToken,
  requireAnyPermission('AGENT_CREATE'),
  loadNode,
  requireNodeOwner,
  validate(grantSchema),
  requireProjectAdmin('projectId'),
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.createGrant(
        req.nodeRecord.id,
        req.body.projectId,
        req.body.role,
        { actorId: req.user.userId, ip: req.ip }
      );
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.delete(
  '/agent-nodes/:id/grants/:grantId',
  verifyToken,
  requireAnyPermission('AGENT_CREATE'),
  loadNode,
  requireNodeOwner,
  requireGrantProjectAdmin,
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.deleteGrant(
        req.nodeRecord.id,
        req.params.grantId,
        { actorId: req.user.userId, ip: req.ip }
      );
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Node-scoped runtime operations (node credential; :id must match)
// ---------------------------------------------------------------------------

router.get(
  '/agent-nodes/:id/config',
  agentNodeAuth,
  bindNode('id'),
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.config(req.node.id);
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.post(
  '/agent-nodes/:id/runtimes',
  agentNodeAuth,
  bindNode('id'),
  validate(declareRuntimesSchema),
  async (req, res, next) => {
    try {
      const items = Array.isArray(req.body) ? req.body : req.body.runtimes;
      const data = await AgentNodeService.declareRuntimes(req.node, items);
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.get(
  '/agent-nodes/:id/runtimes/:runtimeId/provider-config',
  agentNodeAuth,
  bindNode('id'),
  async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT r.id, r.name, r.role, r.effort, r.node_id, r.status AS runtime_status,
                pc.id AS credential_id, pc.status AS credential_status,
                pm.model, pm.max_tokens, pm.effort AS model_effort, pm.status AS model_status,
                pc.api_key_encrypted, pc.provider_type, pc.base_url
         FROM agent_runtimes r
         JOIN provider_models pm ON pm.id = r.model_id
         JOIN provider_credentials pc ON pc.id = pm.credential_id
         WHERE r.id = $1 AND r.node_id = $2`,
        [req.params.runtimeId, req.node.id]
      );
      const row = result.rows[0];
      if (
        !row ||
        row.runtime_status === 'stopped' ||
        row.runtime_status === 'draining' ||
        row.model_status !== 'verified' ||
        row.credential_status !== 'active'
      ) {
        return res.status(404).json(errorBody('RUNTIME_NOT_FOUND', 'Runtime not found'));
      }
      await pool.query(
        `INSERT INTO agent_node_auth_events
           (node_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'provider_config.read', 'node', $2, $3::jsonb)`,
        [
          req.node.id,
          String(req.node.id),
          JSON.stringify({ runtime_id: row.id, credential_id: row.credential_id || null }),
        ]
      );
      res.set('Cache-Control', 'no-store');
      res.json({
        success: true,
        data: {
          runtime_id: row.id,
          role: row.role,
          provider_type: row.provider_type,
          base_url: row.base_url,
          model: row.model,
          max_tokens: row.max_tokens,
          effort: row.effort || row.model_effort,
          api_key: decrypt(row.api_key_encrypted),
        },
      });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Runtime heartbeat and admin patch
// ---------------------------------------------------------------------------

router.post(
  '/agent-runtimes/:id/heartbeat',
  agentNodeAuth,
  agentRuntimeAuth,
  validate(heartbeatSchema),
  async (req, res, next) => {
    try {
      const data = await AgentNodeService.heartbeat(req.node, req.runtime.id, {
        status: req.body.status,
        currentProjectId: req.body.currentProjectId,
      });
      res.json({ success: true, data });
    } catch (error) {
      if (error.status) return fail(res, error);
      next(error);
    }
  }
);

router.patch(
  '/agent-runtimes/:id',
  verifyToken,
  requireAnyPermission('AGENT_CREATE'),
  validate(runtimePatchSchema),
  async (req, res, next) => {
    try {
      const runtime = await pool.query('SELECT * FROM agent_runtimes WHERE id = $1', [
        req.params.id,
      ]);
      if (runtime.rows.length === 0) {
        return res.status(404).json(errorBody('RUNTIME_NOT_FOUND', 'Runtime not found'));
      }
      const node = await pool.query('SELECT * FROM agent_nodes WHERE id = $1', [
        runtime.rows[0].node_id,
      ]);
      if (
        node.rows.length === 0 ||
        (req.user.role !== 'super_admin' &&
          String(node.rows[0].owner_id) !== String(req.user.userId))
      ) {
        return res.status(404).json(errorBody('RUNTIME_NOT_FOUND', 'Runtime not found'));
      }
      const hasEffort = Object.prototype.hasOwnProperty.call(req.body, 'effort');
      const updated = await pool.query(
        `UPDATE agent_runtimes
         SET effort = CASE WHEN $5 THEN $2 ELSE effort END,
             concurrency = COALESCE($3, concurrency),
             status = COALESCE($4, status),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [req.params.id, req.body.effort, req.body.concurrency, req.body.status, hasEffort]
      );
      await pool.query(
        `INSERT INTO agent_node_auth_events
           (node_id, event_type, actor_type, actor_id, metadata)
         VALUES ($1, 'runtime.updated', 'user', $2, $3::jsonb)`,
        [
          runtime.rows[0].node_id,
          String(req.user.userId),
          JSON.stringify({ runtime_id: updated.rows[0].id, effort: req.body.effort ?? null }),
        ]
      );
      res.json({ success: true, data: updated.rows[0] });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;
