const { pool } = require('../db');

/**
 * Runtime role/grant enforcement for node-authenticated requests.
 *
 * A node credential authenticates the host; the `X-Agent-Runtime` header
 * selects the child. Every node call is checked here against the runtime's
 * server-side role, status and `(node, project, role)` grant, so a runtime
 * cannot escalate with an environment variable or header.
 *
 * Legacy agent-key requests (no `_node`) pass through unchanged until the
 * joint clean cut removes them.
 */
const REVIEW_EVENT_TYPES = new Set(['review.result', 'fix.requested']);
const NUMERIC_ID = /^\d+$/;
const UUIDISH = /^[0-9a-fA-F-]{1,64}$/;

function isNodeRequest(req) {
  return Boolean(req.agent && req.agent._node);
}

/**
 * Record an authorization denial without letting an audit failure change the
 * response. Node/runtime identity is retained when available.
 */
async function auditDenial(req, eventType, { projectId = null, metadata = {} } = {}) {
  try {
    await pool.query(
      `INSERT INTO agent_node_auth_events
         (node_id, project_id, event_type, actor_type, actor_id, ip_address, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        req.node && req.node.id ? req.node.id : null,
        projectId == null ? null : projectId,
        eventType,
        req.runtime ? 'runtime' : (req.user ? 'user' : 'agent'),
        String((req.runtime && req.runtime.id)
          ?? (req.agent && req.agent.id)
          ?? (req.user && req.user.userId)
          ?? ''),
        req.ip || null,
        JSON.stringify(metadata),
      ]
    );
  } catch {
    // Authorization already failed closed; auditing is best effort.
  }
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/**
 * Validate a node request's runtime, optional status allowlist and optional
 * role allowlist. Returns true when the caller may continue.
 */
async function checkRuntime(req, res, { roles = null, statuses = null } = {}) {
  if (!isNodeRequest(req)) return true;

  if (!req.runtime) {
    await auditDenial(req, 'auth.runtime_missing', {
      metadata: { path: req.originalUrl || req.path || null },
    });
    deny(res, 400, 'RUNTIME_REQUIRED', 'Missing X-Agent-Runtime header');
    return false;
  }
  if (statuses && !statuses.includes(req.runtime.status)) {
    await auditDenial(req, 'auth.runtime_inactive', {
      metadata: {
        status: req.runtime.status,
        path: req.originalUrl || req.path || null,
      },
    });
    deny(res, 403, 'RUNTIME_INACTIVE', 'Runtime is not running');
    return false;
  }
  if (roles && !roles.includes(req.runtime.role)) {
    await auditDenial(req, 'auth.role_denied', {
      metadata: {
        role: req.runtime.role,
        allowed: roles,
        path: req.originalUrl || req.path || null,
      },
    });
    deny(res, 403, 'FORBIDDEN', 'Runtime role cannot perform this action');
    return false;
  }
  return true;
}

async function hasGrant(nodeId, projectId, role) {
  const result = await pool.query(
    `SELECT 1 FROM agent_node_grants
     WHERE node_id = $1 AND project_id = $2 AND role = $3 AND revoked_at IS NULL`,
    [nodeId, projectId, role]
  );
  return result.rows.length > 0;
}

function validId(res, value, field, pattern) {
  if (pattern.test(String(value))) return true;
  deny(res, 400, 'VALIDATION_ERROR', `${field} is invalid`);
  return false;
}

function projectIdFromBody(body = {}) {
  if (body.projectId != null) return body.projectId;
  if (body.project_id != null) return body.project_id;
  return null;
}

/**
 * Require a runtime header, with an optional list of allowed statuses.
 * Called without arguments it only enforces that a runtime was presented.
 */
function requireRuntime(...statuses) {
  return async (req, res, next) => {
    if (!(await checkRuntime(req, res, {
      statuses: statuses.length ? statuses : null,
    }))) return;
    return next();
  };
}

/** Require one of `roles` for node requests; legacy agent keys pass. */
function requireRole(...roles) {
  return async (req, res, next) => {
    if (!(await checkRuntime(req, res, { roles }))) return;
    return next();
  };
}

/**
 * Require a runtime role plus an active grant for the ticket's project.
 * Resolves `:ticketId` from the route.
 */
function requireTicketGrant(...roles) {
  return async (req, res, next) => {
    if (!(await checkRuntime(req, res, { roles }))) return;
    if (!isNodeRequest(req)) return next();
    if (!validId(res, req.params.ticketId, 'ticketId', NUMERIC_ID)) return;

    try {
      const ticket = await pool.query(
        'SELECT project_id FROM tickets WHERE id = $1',
        [req.params.ticketId]
      );
      if (ticket.rows.length === 0) {
        return deny(res, 404, 'NOT_FOUND', 'Ticket not found');
      }
      const projectId = ticket.rows[0].project_id;
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
        await auditDenial(req, 'auth.grant_denied', {
          projectId,
          metadata: {
            role: req.runtime.role,
            resource: 'ticket',
            ticketId: req.params.ticketId,
          },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'No active grant for this project/role');
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Require a runtime role plus an active grant on the project named by the
 * request body, a referenced ticket, or a referenced harness run.
 */
function requireBodyGrant(...roles) {
  return async (req, res, next) => {
    if (!(await checkRuntime(req, res, { roles }))) return;
    if (!isNodeRequest(req)) return next();

    try {
      const body = req.body || {};
      let projectId = projectIdFromBody(body);
      if (projectId != null && !validId(res, projectId, 'projectId', NUMERIC_ID)) return;
      if (projectId == null && body.ticketId != null) {
        if (!validId(res, body.ticketId, 'ticketId', NUMERIC_ID)) return;
        const ticket = await pool.query(
          'SELECT project_id FROM tickets WHERE id = $1',
          [body.ticketId]
        );
        if (ticket.rows.length === 0) {
          return deny(res, 404, 'NOT_FOUND', 'Ticket not found');
        }
        projectId = ticket.rows[0].project_id;
      }
      if (projectId == null && body.runId != null) {
        if (!validId(res, body.runId, 'runId', UUIDISH)) return;
        const run = await pool.query(
          'SELECT project_id FROM harness_runs WHERE id = $1',
          [body.runId]
        );
        if (run.rows.length === 0) {
          return deny(res, 404, 'NOT_FOUND', 'Harness run not found');
        }
        projectId = run.rows[0].project_id;
      }

      if (projectId == null) {
        await auditDenial(req, 'auth.grant_denied', {
          metadata: { role: req.runtime.role, resource: 'body', reason: 'project_required' },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'Project is required for this action');
      }
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
        await auditDenial(req, 'auth.grant_denied', {
          projectId,
          metadata: { role: req.runtime.role, resource: 'body' },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'No active grant for this project/role');
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Require a runtime role plus an active grant on the project of the harness
 * run named by `:runId`.
 */
function requireRunGrant(...roles) {
  return async (req, res, next) => {
    if (!(await checkRuntime(req, res, { roles }))) return;
    if (!isNodeRequest(req)) return next();
    if (!validId(res, req.params.runId, 'runId', UUIDISH)) return;

    try {
      const run = await pool.query(
        'SELECT project_id FROM harness_runs WHERE id = $1',
        [req.params.runId]
      );
      if (run.rows.length === 0) {
        return deny(res, 404, 'NOT_FOUND', 'Harness run not found');
      }
      const projectId = run.rows[0].project_id;
      if (projectId == null) {
        await auditDenial(req, 'auth.grant_denied', {
          metadata: { role: req.runtime.role, resource: 'run', reason: 'project_missing' },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'Run project is not available');
      }
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
        await auditDenial(req, 'auth.grant_denied', {
          projectId,
          metadata: { role: req.runtime.role, resource: 'run', runId: req.params.runId },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'No active grant for this project/role');
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Require a runtime role plus an active grant on the route's project param.
 */
function requireProjectGrant(...roles) {
  return async (req, res, next) => {
    if (!(await checkRuntime(req, res, { roles }))) return;
    if (!isNodeRequest(req)) return next();

    try {
      const projectId = req.params.projectId ?? req.params.id;
      if (projectId == null) {
        await auditDenial(req, 'auth.grant_denied', {
          metadata: { role: req.runtime.role, resource: 'project', reason: 'project_required' },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'Project is required for this action');
      }
      if (!validId(res, projectId, 'projectId', NUMERIC_ID)) return;
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
        await auditDenial(req, 'auth.grant_denied', {
          projectId,
          metadata: { role: req.runtime.role, resource: 'project' },
        });
        return deny(res, 403, 'GRANT_REQUIRED', 'No active grant for this project/role');
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

/**
 * Review findings (`review.result`, `fix.requested`) are a reviewer
 * capability. Other harness events keep their existing role rules.
 */
function requireReviewEventGrant() {
  return (req, res, next) => {
    if (!isNodeRequest(req)) return next();
    const type = req.body && req.body.type;
    if (!REVIEW_EVENT_TYPES.has(type)) return next();
    return requireBodyGrant('reviewer')(req, res, next);
  };
}

module.exports = {
  auditDenial,
  requireRuntime,
  requireRole,
  requireTicketGrant,
  requireBodyGrant,
  requireProjectGrant,
  requireRunGrant,
  requireReviewEventGrant,
};
