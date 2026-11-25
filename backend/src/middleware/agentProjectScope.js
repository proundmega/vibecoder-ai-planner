const { pool } = require('../db');

/**
 * Project scope for enrollment-issued agents (fg-53).
 *
 * `agents.project_id` is authoritative; legacy `ak_` agents have it NULL and
 * keep the existing owner-scoped checks. The assertion runs before any
 * owner/admin bypass in the handlers.
 *
 * Every middleware carries `agentScope` so the wiring test can enumerate all
 * agent-authenticated project routes and prove none is missing an assertion.
 */
// Node credentials are always project-scoped. A node token without a runtime
// header (or a runtime without an active project) must not be treated like a
// legacy agent with an unrestricted scope, so return a value that can never
// match a real project id.
const UNBOUND_NODE_SCOPE = '__node_runtime_required__';

function isNodeToken(req) {
  return Boolean(req.agent && req.agent._node);
}

function scopedProject(req) {
  if (isNodeToken(req)) {
    if (!req.runtime || req.runtime.current_project_id == null) {
      return UNBOUND_NODE_SCOPE;
    }
    return String(req.runtime.current_project_id);
  }
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

function mark(fn, scope) {
  fn.agentScope = scope;
  return fn;
}

function forQueryProject(param = 'projectId') {
  return mark((req, res, next) => {
    if (scopedProject(req) == null) return next();
    if (!assertAgentProject(req, req.query[param])) return deny(res);
    next();
  }, 'query-project');
}

function forProjectParam(param = 'projectId') {
  return mark((req, res, next) => {
    if (!assertAgentProject(req, req.params[param])) return deny(res);
    next();
  }, 'project');
}

function forBodyProject(field = 'projectId') {
  return mark((req, res, next) => {
    if (!assertAgentProject(req, (req.body || {})[field])) return deny(res);
    next();
  }, 'body-project');
}

async function projectForTicket(ticketId) {
  const result = await pool.query('SELECT project_id FROM tickets WHERE id = $1', [ticketId]);
  return result.rows[0] ? result.rows[0].project_id : null;
}

async function projectForRun(runId) {
  const result = await pool.query('SELECT project_id FROM harness_runs WHERE id = $1', [runId]);
  return result.rows[0] ? result.rows[0].project_id : null;
}

function forBodyTicket(field = 'ticketId') {
  return mark(async (req, res, next) => {
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
  }, 'body-ticket');
}

function forTicketParam(param = 'ticketId') {
  return mark(async (req, res, next) => {
    if (scopedProject(req) == null) return next();
    // Leave malformed ids to validatePathParams (400) instead of sending them
    // to PostgreSQL, which would raise 22P02 and become a 500.
    if (!/^\d+$/.test(String(req.params[param]))) return next();
    try {
      const projectId = await projectForTicket(req.params[param]);
      if (projectId != null && !assertAgentProject(req, projectId)) return deny(res);
      next();
    } catch (error) {
      next(error);
    }
  }, 'ticket');
}

function forRunParam(param = 'runId') {
  return mark(async (req, res, next) => {
    if (scopedProject(req) == null) return next();
    // harness_runs.id is a UUID; let the path validator reject malformed ids.
    if (!/^[0-9a-fA-F-]{1,64}$/.test(String(req.params[param]))) return next();
    try {
      const projectId = await projectForRun(req.params[param]);
      if (projectId != null && !assertAgentProject(req, projectId)) return deny(res);
      next();
    } catch (error) {
      next(error);
    }
  }, 'run');
}

/**
 * Harness events may reference a project, ticket and/or run. Every reference
 * that is present must match the agent's project.
 */
function forHarnessEventBody() {
  return mark(async (req, res, next) => {
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
  }, 'event');
}

function selfAgentOnly(param = 'agentId') {
  return mark((req, res, next) => {
    if (!req.agent) return next(); // JWT operator
    if (String(req.agent.id) !== String(req.params[param])) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Agent can only read its own resources' },
      });
    }
    next();
  }, 'self');
}

module.exports = {
  assertAgentProject,
  isNodeToken,
  forProjectParam,
  forQueryProject,
  forBodyProject,
  forBodyTicket,
  forTicketParam,
  forRunParam,
  forHarnessEventBody,
  selfAgentOnly,
};
