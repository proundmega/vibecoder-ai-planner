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

function isNodeRequest(req) {
  return Boolean(req.agent && req.agent._node);
}

function deny(res, status, code, message) {
  return res.status(status).json({ success: false, error: { code, message } });
}

/**
 * Validate a node request's runtime, optional status allowlist and optional
 * role allowlist. Returns true when the caller may continue.
 */
function checkRuntime(req, res, { roles = null, statuses = null } = {}) {
  if (!isNodeRequest(req)) return true;

  if (!req.runtime) {
    deny(res, 400, 'RUNTIME_REQUIRED', 'Missing X-Agent-Runtime header');
    return false;
  }
  if (statuses && !statuses.includes(req.runtime.status)) {
    deny(res, 403, 'RUNTIME_INACTIVE', 'Runtime is not running');
    return false;
  }
  if (roles && !roles.includes(req.runtime.role)) {
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
  return (req, res, next) => {
    if (!checkRuntime(req, res, { statuses: statuses.length ? statuses : null })) return;
    return next();
  };
}

/** Require one of `roles` for node requests; legacy agent keys pass. */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!checkRuntime(req, res, { roles })) return;
    return next();
  };
}

/**
 * Require a runtime role plus an active grant for the ticket's project.
 * Resolves `:ticketId` from the route.
 */
function requireTicketGrant(...roles) {
  return async (req, res, next) => {
    if (!checkRuntime(req, res, { roles })) return;
    if (!isNodeRequest(req)) return next();

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
    if (!checkRuntime(req, res, { roles })) return;
    if (!isNodeRequest(req)) return next();

    try {
      const body = req.body || {};
      let projectId = projectIdFromBody(body);
      if (projectId == null && body.ticketId != null) {
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
        if (!/^[0-9a-fA-F-]{1,64}$/.test(String(body.runId))) {
          return deny(res, 400, 'VALIDATION_ERROR', 'Invalid runId');
        }
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
        return deny(res, 403, 'GRANT_REQUIRED', 'Project is required for this action');
      }
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
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
    if (!checkRuntime(req, res, { roles })) return;
    if (!isNodeRequest(req)) return next();

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
        return deny(res, 403, 'GRANT_REQUIRED', 'Run project is not available');
      }
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
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
    if (!checkRuntime(req, res, { roles })) return;
    if (!isNodeRequest(req)) return next();

    try {
      const projectId = req.params.projectId ?? req.params.id;
      if (projectId == null) {
        return deny(res, 403, 'GRANT_REQUIRED', 'Project is required for this action');
      }
      if (!(await hasGrant(req.node.id, projectId, req.runtime.role))) {
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
  requireRuntime,
  requireRole,
  requireTicketGrant,
  requireBodyGrant,
  requireProjectGrant,
  requireRunGrant,
  requireReviewEventGrant,
};
