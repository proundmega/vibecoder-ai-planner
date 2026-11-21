const AgentNodeService = require('../services/AgentNodeService');
const { auditDenial } = require('./agentRole');

function unauthorized(res, result) {
  const code = result.status === 'expired'
    ? 'TOKEN_EXPIRED'
    : result.status === 'revoked'
      ? 'TOKEN_REVOKED'
      : 'UNAUTHORIZED';
  return res.status(401).json({
    success: false,
    error: { code, message: 'Invalid or expired node credential' },
  });
}

/** Authenticate `X-API-Key: at_…` as a node credential. */
async function agentNodeAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Missing node credential' },
    });
  }
  try {
    const result = await AgentNodeService.authenticateAccessToken(apiKey);
    if (result.status !== 'ok') return unauthorized(res, result);
    req.node = result.node;
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: { code: 'UNAUTHORIZED', message: 'Invalid node credential' },
    });
  }
}

/** Bind a node-scoped route parameter to the presented credential. */
function bindNode(param = 'id') {
  return async (req, res, next) => {
    if (!req.node || String(req.node.id) !== String(req.params[param])) {
      await auditDenial(req, 'auth.node_binding_denied', {
        metadata: {
          presentedNodeId: req.node ? req.node.id : null,
          requestedNodeId: req.params[param],
        },
      });
      return res.status(404).json({
        success: false,
        error: { code: 'NODE_NOT_FOUND', message: 'Node not found' },
      });
    }
    return next();
  };
}

module.exports = { agentNodeAuth, bindNode };
