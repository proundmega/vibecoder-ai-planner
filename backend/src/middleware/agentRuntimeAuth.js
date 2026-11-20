const AgentNodeService = require('../services/AgentNodeService');

/**
 * Resolve `X-Agent-Runtime` for a node-authenticated request and prove the
 * runtime belongs to that node. Runtime-scoped routes call this after
 * `agentNodeAuth`.
 */
async function agentRuntimeAuth(req, res, next) {
  const runtimeId = req.headers['x-agent-runtime'];
  if (!runtimeId) {
    return res.status(400).json({
      success: false,
      error: { code: 'RUNTIME_REQUIRED', message: 'Missing X-Agent-Runtime header' },
    });
  }
  try {
    req.runtime = await AgentNodeService.getRuntimeForNode(req.node.id, runtimeId);
    return next();
  } catch (error) {
    if (error.status === 404) {
      return res.status(404).json({
        success: false,
        error: { code: 'RUNTIME_NOT_FOUND', message: 'Runtime not found' },
      });
    }
    return next(error);
  }
}

module.exports = { agentRuntimeAuth };
