const { pool } = require('../db');

/**
 * Project scope for enrollment-issued agents (fg-53).
 *
 * `agents.project_id` is authoritative; legacy `ak_` agents have it NULL and
 * keep the existing owner-scoped checks. The assertion runs before any
 * owner/admin bypass in the handlers.
 */
function scopedProject(req) {
  return req.agent && req.agent.project_id != null ? String(req.agent.project_id) : null;
}

function deny(res) {
  return res.status(403).json({
    success: false,
    error: { code: 'FORBIDDEN', message: 'Agent is not authorized for this project' },
  });
}

function assertAgentProject(req, projectId) {
  const scope = scopedProject(req);
  if (scope == null) return true;
  return projectId != null && String(projectId) === scope;
}

function forProjectParam(param = 'projectId') {
  return (req, res, next) => {
    if (!assertAgentProject(req, req.params[param])) return deny(res);
    next();
  };
}

function forBodyProject(field = 'projectId') {
  return (req, res, next) => {
    if (!assertAgentProject(req, (req.body || {})[field])) return deny(res);
    next();
  };
}

function forBodyTicket(field = 'ticketId') {
  return async (req, res, next) => {
    if (scopedProject(req) == null) return next();
    try {
      const ticketId = (req.body || {})[field];
      if (ticketId == null) return next();
      if (!/^\d+$/.test(String(ticketId))) return next();
      const projectId = await projectForTicket(ticketId);
      if (projectId != null && !assertAgentProject(req, projectId)) return deny(res);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function forTicketParam(param = 'ticketId') {
  return async (req, res, next) => {
    if (scopedProject(req) == null) return next();
    // Leave malformed ids to validatePathParams (400) instead of sending them
    // to PostgreSQL, which would raise 22P02 and become a 500.
    if (!/^\d+$/.test(String(req.params[param]))) return next();
    try {
      const result = await pool.query('SELECT project_id FROM tickets WHERE id = $1', [req.params[param]]);
      if (result.rows.length === 0) return next();
      if (!assertAgentProject(req, result.rows[0].project_id)) return deny(res);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function forRunParam(param = 'runId') {
  return async (req, res, next) => {
    if (scopedProject(req) == null) return next();
    // harness_runs.id is a UUID; let the path validator reject malformed ids.
    if (!/^[0-9a-fA-F-]{1,64}$/.test(String(req.params[param]))) return next();
    try {
      const result = await pool.query('SELECT project_id FROM harness_runs WHERE id = $1', [req.params[param]]);
      if (result.rows.length === 0) return next();
      if (!assertAgentProject(req, result.rows[0].project_id)) return deny(res);
      next();
    } catch (error) {
      next(error);
    }
  };
}

async function projectForTicket(ticketId) {
  const result = await pool.query('SELECT project_id FROM tickets WHERE id = $1', [ticketId]);
  return result.rows[0] ? result.rows[0].project_id : null;
}

async function projectForRun(runId) {
  const result = await pool.query('SELECT project_id FROM harness_runs WHERE id = $1', [runId]);
  return result.rows[0] ? result.rows[0].project_id : null;
}

/**
 * Harness events may reference a project, ticket and/or run. Every reference
 * that is present must match the agent's project.
 */
function forHarnessEventBody() {
  return async (req, res, next) => {
    if (scopedProject(req) == null) return next();
    try {
      const body = req.body || {};
      if (body.projectId != null && !assertAgentProject(req, body.projectId)) return deny(res);
      if (body.ticketId != null) {
        if (!/^\d+$/.test(String(body.ticketId))) return next();
        const projectId = await projectForTicket(body.ticketId);
        if (projectId != null && !assertAgentProject(req, projectId)) return deny(res);
      }
      if (body.runId != null) {
        if (!/^[0-9a-fA-F-]{1,64}$/.test(String(body.runId))) return next();
        const projectId = await projectForRun(body.runId);
        if (projectId != null && !assertAgentProject(req, projectId)) return deny(res);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

function selfAgentOnly(param = 'agentId') {
  return (req, res, next) => {
    if (!req.agent) return next(); // JWT operator
    if (String(req.agent.id) !== String(req.params[param])) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Agent can only read its own resources' },
      });
    }
    next();
  };
}

module.exports = {
  assertAgentProject,
  forProjectParam,
  forBodyProject,
  forBodyTicket,
  forTicketParam,
  forRunParam,
  forHarnessEventBody,
  selfAgentOnly,
};
