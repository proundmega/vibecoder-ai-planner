const { pool } = require('../db');

/**
 * Runtime role/grant enforcement for node-authenticated requests.
 * Legacy agent-key requests (no `_node`) pass through unchanged until the
 * joint clean cut removes them.
 */
function requireRuntime(req, res, next) {
  if (!req.agent || !req.agent._node) return next();
  if (!req.runtime) {
    return res.status(400).json({
      success: false,
      error: { code: 'RUNTIME_REQUIRED', message: 'Missing X-Agent-Runtime header' },
    });
  }
  return next();
}

function requireTicketGrant(...roles) {
  return async (req, res, next) => {
    if (!req.agent || !req.agent._node) return next();
    if (!req.runtime || !roles.includes(req.runtime.role)) {
      return res.status(403).json({
        success: false,
        error: { code: 'FORBIDDEN', message: 'Runtime role cannot perform this action' },
      });
    }
    try {
      const ticket = await pool.query(
        'SELECT project_id FROM tickets WHERE id = $1',
        [req.params.ticketId]
      );
      if (ticket.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Ticket not found' },
        });
      }
      const grant = await pool.query(
        `SELECT 1 FROM agent_node_grants
         WHERE node_id = $1 AND project_id = $2 AND role = $3 AND revoked_at IS NULL`,
        [req.node.id, ticket.rows[0].project_id, req.runtime.role]
      );
      if (grant.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: { code: 'GRANT_REQUIRED', message: 'No active grant for this project/role' },
        });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = { requireRuntime, requireTicketGrant };
