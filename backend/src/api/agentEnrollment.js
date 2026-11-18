const express = require('express');
const { pool } = require('../db');
const AgentEnrollmentService = require('../services/AgentEnrollmentService');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const agentEnrollmentRateLimit = require('../middleware/agentEnrollmentRateLimit');
const logger = require('../utils/logger');
const {
  mintSchema,
  enrollSchema,
  refreshSchema,
  listQuerySchema,
} = require('../validators/agentEnrollment');

const router = express.Router();

function enrollmentEnabled() {
  // Explicit opt-in only: NODE_ENV=development is not enough, so a dev-mode
  // container exposed to a network cannot silently offer enrollment. Compose
  // uses `1`, so accept the common boolean spellings.
  const value = String(process.env.AGENT_ENROLLMENT_ENABLED || '').trim().toLowerCase();
  return value === '1' || value === 'true';
}

router.use((req, res, next) => {
  if (!enrollmentEnabled()) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  }
  next();
});

function isLoopback(ip) {
  if (!ip) return false;
  const normalized = ip.replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized.startsWith('127.');
}

/**
 * Enrollment/refresh carry bearer secrets, so plain HTTP is refused outside
 * loopback unless the operator opts in for local testing.
 */
function requireSecureTransport(req, res, next) {
  if (process.env.ALLOW_INSECURE_AGENT_ENROLLMENT === '1') return next();
  if (process.env.NODE_ENV === 'test' || process.env.INTEGRATION_TESTS === '1') return next();

  // `req.secure` only reflects X-Forwarded-Proto when Express `trust proxy`
  // is configured (TRUST_PROXY), so a direct client cannot spoof this check.
  if (req.secure) return next();
  if (isLoopback(req.ip || req.socket?.remoteAddress)) return next();

  return res.status(403).json({
    success: false,
    error: {
      code: 'TLS_REQUIRED',
      message: 'Agent enrollment requires HTTPS (set ALLOW_INSECURE_AGENT_ENROLLMENT=1 for local testing)',
    },
  });
}

function errorBody(code, message) {
  return { success: false, error: { code, message } };
}

async function projectForUser(req, projectId) {
  const project = await pool.query('SELECT id, owner_id FROM projects WHERE id = $1', [projectId]);
  if (project.rows.length === 0) {
    const error = new Error('Project not found');
    error.status = 404;
    throw error;
  }

  const row = project.rows[0];
  if (req.user.role === 'super_admin' || String(row.owner_id) === String(req.user.userId)) {
    return row;
  }

  const membership = await pool.query(
    'SELECT 1 FROM project_memberships WHERE project_id = $1 AND user_id = $2',
    [projectId, req.user.userId]
  );
  if (membership.rows.length === 0) {
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }
  return row;
}

/**
 * @openapi
 * /agent-enrollment/tokens:
 *   post:
 *     tags: [Agent Enrollment]
 *     summary: Mint a one-time project join token
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [project_id, name]
 *             properties:
 *               project_id: { type: integer }
 *               name: { type: string, maxLength: 100 }
 *               ttl_seconds: { type: integer, minimum: 60, maximum: 86400 }
 *               max_uses: { type: integer, minimum: 1, maximum: 100 }
 *               provider_id: { type: integer, nullable: true }
 *     responses:
 *       201:
 *         description: Join token created; the raw token is returned once
 *       400:
 *         description: Validation failed
 *       403:
 *         description: Project membership required
 *   get:
 *     tags: [Agent Enrollment]
 *     summary: List join-token metadata for a project
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: project_id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Token metadata without secrets
 */
router.post(
  '/tokens',
  verifyToken,
  requireAnyPermission('AGENT_CREATE'),
  agentEnrollmentRateLimit({ max: 30, scope: 'mint' }),
  validate(mintSchema),
  async (req, res) => {
    try {
      const projectId = req.body.project_id;
      await projectForUser(req, projectId);

      const token = await AgentEnrollmentService.mint({
        projectId,
        name: req.body.name,
        ttlSeconds: req.body.ttl_seconds,
        maxUses: req.body.max_uses,
        providerId: req.body.provider_id || null,
        createdBy: req.user.userId,
        ip: req.ip,
      });

      res.status(201).json({
        success: true,
        data: {
          id: token.id,
          name: token.name,
          project_id: token.project_id,
          provider_id: token.provider_id,
          token: token.token,
          expires_at: token.expires_at,
          max_uses: token.max_uses,
        },
      });
    } catch (error) {
      if (error.status === 404) return res.status(404).json(errorBody('NOT_FOUND', 'Project not found'));
      if (error.status === 403) return res.status(403).json(errorBody('FORBIDDEN', 'Project membership required'));
      if (error.code === 'PROVIDER_NOT_FOUND') {
        return res.status(404).json(errorBody('PROVIDER_NOT_FOUND', 'Provider not found'));
      }
      logger.error('POST /api/v1/agent-enrollment/tokens', error);
      res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Could not create enrollment token'));
    }
  }
);

router.get(
  '/tokens',
  verifyToken,
  requireAnyPermission('AGENT_READ'),
  validate({ query: listQuerySchema }),
  async (req, res) => {
    try {
      const projectId = req.query.project_id;
      await projectForUser(req, projectId);
      const tokens = await AgentEnrollmentService.list(projectId);
      res.json({ success: true, data: tokens });
    } catch (error) {
      if (error.status === 404) return res.status(404).json(errorBody('NOT_FOUND', 'Project not found'));
      if (error.status === 403) return res.status(403).json(errorBody('FORBIDDEN', 'Project membership required'));
      logger.error('GET /api/v1/agent-enrollment/tokens', error);
      res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Could not list enrollment tokens'));
    }
  }
);

/**
 * @openapi
 * /agent-enrollment/tokens/{id}:
 *   delete:
 *     tags: [Agent Enrollment]
 *     summary: Revoke a join token
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Token revoked
 *       404:
 *         description: Token not found
 */
router.delete(
  '/tokens/:id',
  verifyToken,
  requireAnyPermission('AGENT_REVOKE'),
  async (req, res) => {
    try {
      const existing = await pool.query(
        'SELECT id, project_id, revoked_at FROM agent_enrollment_tokens WHERE id = $1',
        [req.params.id]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json(errorBody('NOT_FOUND', 'Enrollment token not found'));
      }
      await projectForUser(req, existing.rows[0].project_id);

      const revoked = await AgentEnrollmentService.revoke(req.params.id, {
        ip: req.ip,
        actorId: req.user.userId,
      });
      if (!revoked) {
        return res.status(404).json(errorBody('NOT_FOUND', 'Enrollment token not found'));
      }
      res.json({ success: true, data: revoked });
    } catch (error) {
      if (error.status === 404) return res.status(404).json(errorBody('NOT_FOUND', 'Project not found'));
      if (error.status === 403) return res.status(403).json(errorBody('FORBIDDEN', 'Project membership required'));
      logger.error('DELETE /api/v1/agent-enrollment/tokens/:id', error);
      res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Could not revoke enrollment token'));
    }
  }
);

/**
 * @openapi
 * /agent-enrollment/enroll:
 *   post:
 *     tags: [Agent Enrollment]
 *     summary: Exchange a join token for node credentials
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [token, name]
 *             properties:
 *               token: { type: string }
 *               name: { type: string, maxLength: 100 }
 *               node_metadata: { type: object }
 *     responses:
 *       201:
 *         description: Agent created with an access/refresh credential pair
 *       401:
 *         description: Join token invalid, expired, revoked or exhausted
 *       403:
 *         description: TLS required
 *       429:
 *         description: Rate limited
 */
router.post(
  '/enroll',
  requireSecureTransport,
  agentEnrollmentRateLimit({
    max: 20,
    scope: 'enroll',
    keyFn: req => (typeof req.body?.token === 'string' ? req.body.token.slice(0, 12) : 'none'),
  }),
  validate(enrollSchema),
  async (req, res) => {
    try {
      const credentials = await AgentEnrollmentService.enroll({
        token: req.body.token,
        name: req.body.name,
        nodeMetadata: req.body.node_metadata,
        ip: req.ip,
      });
      res.status(201).json({ success: true, data: credentials });
    } catch (error) {
      if (!(error instanceof AgentEnrollmentService.EnrollmentError)) {
        logger.error('POST /api/v1/agent-enrollment/enroll', error);
        return res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Could not enroll the agent'));
      }
      // All join-token failures look the same to the caller so a token prefix
      // cannot be probed. The precise reason is recorded in the audit event.
      await AgentEnrollmentService.audit(pool, {
        eventType: 'enrollment.failed',
        ip: req.ip,
        metadata: { reason: error.code || 'UNKNOWN' },
      }).catch(() => {});
      return res.status(401).json(
        errorBody('ENROLLMENT_TOKEN_INVALID', 'Enrollment token is invalid, expired or already used')
      );
    }
  }
);

/**
 * @openapi
 * /agent-enrollment/refresh:
 *   post:
 *     tags: [Agent Enrollment]
 *     summary: Rotate a node refresh token
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [refresh_token, idempotency_key]
 *             properties:
 *               refresh_token: { type: string }
 *               idempotency_key:
 *                 type: string
 *                 description: Random per-attempt key; retries with the same key return the identical pair
 *     responses:
 *       200:
 *         description: New access/refresh credential pair
 *       401:
 *         description: Refresh token invalid or reused
 *       403:
 *         description: TLS required
 *       429:
 *         description: Rate limited
 */
router.post(
  '/refresh',
  requireSecureTransport,
  agentEnrollmentRateLimit({
    max: 60,
    scope: 'refresh',
    keyFn: req => (typeof req.body?.refresh_token === 'string' ? req.body.refresh_token.slice(0, 12) : 'none'),
  }),
  validate(refreshSchema),
  async (req, res) => {
    try {
      const credentials = await AgentEnrollmentService.refresh({
        token: req.body.refresh_token,
        idempotencyKey: req.body.idempotency_key,
        ip: req.ip,
      });
      res.json({ success: true, data: credentials });
    } catch (error) {
      if (error.status === 400 || error.status === 401) {
        return res.status(error.status).json(errorBody(error.code, error.message));
      }
      logger.error('POST /api/v1/agent-enrollment/refresh', error);
      return res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Could not refresh credentials'));
    }
  }
);

/**
 * @openapi
 * /agent-enrollment/agents/{agentId}:
 *   get:
 *     tags: [Agent Enrollment]
 *     summary: Enrollment metadata for an agent (no secrets)
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: integer }
 *     responses:
 *       200:
 *         description: Enrollment metadata
 *       404:
 *         description: Agent not found
 */
router.get(
  '/agents/:agentId',
  verifyToken,
  requireAnyPermission('AGENT_READ'),
  async (req, res) => {
    try {
      const metadata = await AgentEnrollmentService.getEnrollmentMetadata(req.params.agentId);
      if (!metadata) {
        return res.status(404).json(errorBody('NOT_FOUND', 'Agent not found'));
      }
      if (req.user.role !== 'super_admin') {
        const agent = await pool.query('SELECT owner_id FROM agents WHERE id = $1', [req.params.agentId]);
        if (agent.rows.length === 0 || String(agent.rows[0].owner_id) !== String(req.user.userId)) {
          return res.status(404).json(errorBody('NOT_FOUND', 'Agent not found'));
        }
      }
      res.json({ success: true, data: metadata });
    } catch (error) {
      logger.error('GET /api/v1/agent-enrollment/agents/:agentId', error);
      res.status(500).json(errorBody('INTERNAL_SERVER_ERROR', 'Could not load enrollment metadata'));
    }
  }
);

module.exports = router;
module.exports.requireSecureTransport = requireSecureTransport;
module.exports.enrollmentEnabled = enrollmentEnabled;
