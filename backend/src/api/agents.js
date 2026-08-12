const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const AgentService = require('../services/AgentService');
const ProviderService = require('../services/ProviderService');
const PermissionService = require('../services/PermissionService');
const { verifyTokenOrAgent } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { updateAgentSchema } = require('../validators/agents');
const Joi = require('joi');
const logger = require('../utils/logger');
const createAgentSchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    'string.empty': 'name is required',
    'string.min': 'name must be at least 1 character',
    'string.max': 'name must not exceed 100 characters',
    'any.required': 'name is required',
  }),
  providerId: Joi.alternatives().try(Joi.string(), Joi.number()).optional().allow(null),
  rateLimit: Joi.number().integer().min(1).max(10000).optional(),
  maxActionsPerDay: Joi.number().integer().min(1).max(100000).optional(),
  keyExpiryDays: Joi.number().integer().min(1).max(365).optional(),
});

function maskAgentList(agents) {
  return agents.map(agent => {
    const masked = { ...agent };
    delete masked.api_key;
    if (masked.api_key_hash) masked.api_key_hash = '***';
    if (masked.api_key_hash_prefix) masked.api_key_hash_prefix = '***';
    return masked;
  });
}

/**
 * @openapi
 * /agents/create:
 *   post:
 *     tags: [Agents]
 *     summary: Create a new agent
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       201:
 *         description: Agent created with API key
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id: { type: string, format: uuid }
 *                 name: { type: string }
 *                 user_id: { type: string, format: uuid }
 *                 api_key: { type: string }
 *                 generatedApiKey: { type: string }
 *       400:
 *         description: Creation failed
 */
router.post('/create', verifyTokenOrAgent, requireAnyPermission('AGENT_CREATE'), validate(createAgentSchema), async (req, res) => {
  try {
    const { name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays } = req.body;
    const apiKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
    const agent = await AgentService.create(name, apiKey, req.user.userId, { providerId: providerId || null, rateLimit, maxActionsPerDay, keyExpiryDays });
    res.status(201).json({ ...agent, generatedApiKey: apiKey });
  } catch (error) {
    logger.error('POST /api/agents/create', error);
    if (error.message === 'PROVIDER_NOT_FOUND') {
      return res.status(404).json({ error: 'Provider not found' });
    }
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents:
 *   get:
 *     tags: [Agents]
 *     summary: List user's agents
 *     responses:
 *       200:
 *         description: List of agents
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agents:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Agent'
 */
router.get('/', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res) => {
  try {
    const agents = await AgentService.list(req.user.userId);
    res.json({ agents: maskAgentList(agents) });
  } catch (error) {
    logger.error('GET /api/agents', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents/revoke/{agentId}:
 *   post:
 *     tags: [Agents]
 *     summary: Revoke agent API key
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: API key revoked
 *       400:
 *         description: Revoke failed
 */
router.post('/revoke/:agentId', verifyTokenOrAgent, requireAnyPermission('AGENT_REVOKE'), async (req, res) => {
  try {
    await AgentService.revokeApiKey(req.params.agentId);
    res.json({ message: 'API key revoked' });
  } catch (error) {
    logger.error('POST /api/agents/revoke/:agentId', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents/{agentId}:
 *   put:
 *     tags: [Agents]
 *     summary: Update agent name
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *     responses:
 *       200:
 *         description: Agent updated
 *       400:
 *         description: Validation failed
 *       404:
 *         description: Agent not found
 */
router.put('/:agentId', verifyTokenOrAgent, requireAnyPermission('AGENT_REVOKE'), validate(updateAgentSchema), async (req, res) => {
  try {
    const { name } = req.body;
    const result = await AgentService.updateName(req.params.agentId, name, req.user.userId);
    res.json(result);
  } catch (error) {
    if (error.message === 'AGENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Agent not found' });
    }
    logger.error('PUT /api/agents/:agentId', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents/{agentId}:
 *   delete:
 *     tags: [Agents]
 *     summary: Delete agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agent deleted
 *       400:
 *         description: Deletion failed
 */
router.delete('/:agentId', verifyTokenOrAgent, requireAnyPermission('AGENT_DELETE'), async (req, res) => {
  try {
    await AgentService.delete(req.params.agentId);
    res.json({ message: 'Agent deleted' });
  } catch (error) {
    logger.error('DELETE /api/agents/:agentId', error);
    res.status(400).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents/{agentId}/history:
 *   get:
 *     tags: [Agents]
 *     summary: Get agent activity history
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agent activity history
 *       403:
 *         description: Forbidden
 */
router.get('/:agentId/history', verifyTokenOrAgent, requireAnyPermission('AGENT_READ'), async (req, res, _next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    let agent;
    if (apiKey) {
      agent = await AgentService.getAgentByApiKey(apiKey);
      if (!agent || agent.id !== req.params.agentId) {
        return res.status(403).json({ error: 'Forbidden' });
      }
    } else if (req.user && req.user.userId) {
      const agents = await AgentService.list(req.user.userId);
      agent = agents.find(a => a.id === req.params.agentId);
      if (!agent) {
        return res.status(404).json({ error: 'Agent not found' });
      }
    } else {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const history = await AgentService.getAgentHistory(agent.id, 100);
    const dailySummary = history.reduce((acc, action) => {
      const date = action.created_at.split('T')[0];
      if (!acc[date]) {
        acc[date] = { count: 0, totalCost: 0, actions: [] };
      }
      acc[date].count++;
      acc[date].totalCost += action.cost_incurred || 0.05;
      acc[date].actions.push({ type: action.action_type, timestamp: action.created_at });
      return acc;
    }, {});

    res.json({
      agentName: agent.name,
      totalActions: history.length,
      totalCost: history.reduce((sum, a) => sum + (a.cost_incurred || 0), 0),
      daily: Object.keys(dailySummary).map(date => ({
        date,
        count: dailySummary[date].count,
        totalCost: dailySummary[date].totalCost,
      })),
    });
  } catch (error) {
    logger.error('GET /api/agents/:agentId/history', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents/{agentId}/key:
 *   get:
 *     tags: [Agents]
 *     summary: Get agent API key info (preview only)
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: Agent key info
 *       404:
 *         description: Agent not found
 */
router.get('/:agentId/key', verifyTokenOrAgent, async (req, res) => {
  try {
    const userId = req.agent ? req.agent.owner_id : req.user.userId;
    const agents = await AgentService.list(userId);
    const agent = agents.find(a => String(a.id) === String(req.params.agentId));
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json({
      name: agent.name,
      keyPreview: agent.api_key ? agent.api_key.substring(0, 8) + '***' : 'None',
      rateLimit: agent.rate_limit,
      maxActionsPerDay: agent.max_actions_per_day,
    });
  } catch (error) {
    logger.error('GET /api/agents/:agentId/key', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * @openapi
 * /agents/{agentId}/provider-config:
 *   get:
 *     tags: [Agents]
 *     summary: Get decrypted provider config for agent
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     headers:
 *       X-API-Key:
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Provider config
 *       401:
 *         description: Missing API key
 *       404:
 *         description: Agent or provider not found
 */
router.get('/:agentId/provider-config', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ success: false, error: { code: 'MISSING_API_KEY', message: 'X-API-Key header required' } });
    }
    const config = await AgentService.getProviderConfig(req.params.agentId, apiKey);
    res.json({ success: true, data: config });
  } catch (error) {
    const errorMessages = {
      AGENT_NOT_FOUND: { code: 'AGENT_NOT_FOUND', message: 'Agent not found' },
      NO_PROVIDER: { code: 'NO_PROVIDER', message: 'Agent has no provider configured' },
      PROVIDER_NOT_FOUND: { code: 'PROVIDER_NOT_FOUND', message: 'Provider configuration not found' },
    };
    if (error.message in errorMessages) {
      return res.status(404).json({ success: false, error: errorMessages[error.message] });
    }
    logger.error('GET /api/agents/:agentId/provider-config', error);
    next(error);
  }
});

/**
 * @openapi
 * /agents/{agentId}/provider-config/changed:
 *   get:
 *     tags: [Agents]
 *     summary: Check if provider config has changed
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *       - in: query
 *         name: since
 *         schema: { type: string, format: date-time }
 *     security:
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Config change status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success: { type: boolean }
 *                 data:
 *                   type: object
 *                   properties:
 *                     changed: { type: boolean }
 *                     lastUpdated: { type: string, format: date-time }
 */
router.get('/:agentId/provider-config/changed', verifyTokenOrAgent, async (req, res, next) => {
  try {
    const agentId = req.params.agentId;
    const since = req.query.since;
    
    // Ownership check: agent can only poll its own config-change status
    if (req.agent) {
      const agent = await AgentService.findById(agentId);
      if (!agent || String(agent.id) !== String(req.agent.id)) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Invalid API key for this agent' }
        });
      }
    } else if (req.user) {
      // JWT-authenticated users need AGENT_READ permission
      const hasPermission = await PermissionService.hasPermission(req.user.role, 'AGENT_READ');
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Insufficient permissions' }
        });
      }
    }
    
    const result = await ProviderService.getProviderConfigChange(agentId, since);
    
    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    logger.error('GET /api/agents/:agentId/provider-config/changed', error);
    next(error);
  }
});

/**
 * @openapi
 * /agents/{agentId}/rotate-key:
 *   post:
 *     tags: [Agents]
 *     summary: Rotate agent API key
 *     parameters:
 *       - in: path
 *         name: agentId
 *         required: true
 *         schema: { type: string, format: uuid }
 *     responses:
 *       200:
 *         description: API key rotated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 agentId: { type: integer }
 *                 agentName: { type: string }
 *                 newApiKey: { type: string }
 *                 expiresAt: { type: string, format: date-time }
 *                 message: { type: string }
 *       404:
 *         description: Agent not found
 */
router.post('/:agentId/rotate-key', verifyTokenOrAgent, requireAnyPermission('AGENT_REVOKE'), async (req, res) => {
  try {
    const result = await AgentService.rotateKey(req.params.agentId, req.user.userId);
    res.json({
      success: true,
      data: {
        agentId: result.id,
        agentName: result.name,
        newApiKey: result.api_key,
        expiresAt: result.api_key_expires_at,
        message: 'Key rotated. Store this key securely — it will not be shown again.',
      },
    });
  } catch (error) {
    if (error.message === 'AGENT_NOT_FOUND') {
      return res.status(404).json({ error: 'Agent not found' });
    }
    logger.error('POST /api/agents/{agentId}/rotate-key', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
