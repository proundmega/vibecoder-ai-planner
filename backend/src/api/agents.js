const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const TicketService = require('../services/TicketService');
const ProjectService = require('../services/ProjectService');
const AgentService = require('../services/AgentService');
const { verifyToken } = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permissions');
const { validate } = require('../middleware/validate');
const { createTicketSchema, editTicketSchema, claimTicketSchema, statusChangeSchema } = require('../validators/agents');

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
router.post('/create', verifyToken, requireAnyPermission('AGENT_CREATE'), validate(createTicketSchema), async (req, res) => {
  try {
    const { name } = req.body;
    const apiKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
    const agent = await AgentService.create(name, apiKey, req.user.userId);
    res.status(201).json({ ...agent, generatedApiKey: apiKey });
  } catch (error) {
    console.error('POST /api/agents/create', error);
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
router.get('/', verifyToken, requireAnyPermission('AGENT_READ'), async (req, res) => {
  try {
    const agents = await AgentService.list(req.user.userId);
    res.json({ agents });
  } catch (error) {
    console.error('GET /api/agents', error);
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
router.post('/revoke/:agentId', verifyToken, requireAnyPermission('AGENT_REVOKE'), async (req, res) => {
  try {
    await AgentService.revokeApiKey(req.params.agentId);
    res.json({ message: 'API key revoked' });
  } catch (error) {
    console.error('POST /api/agents/revoke/:agentId', error);
    res.status(400).json({ error: error.message });
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
router.delete('/:agentId', verifyToken, requireAnyPermission('AGENT_DELETE'), async (req, res) => {
  try {
    await AgentService.delete(req.params.agentId);
    res.json({ message: 'Agent deleted' });
  } catch (error) {
    console.error('DELETE /api/agents/:agentId', error);
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
router.get('/:agentId/history', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    let agent;
    if (apiKey) {
      agent = await AgentService.getAgentByApiKey(apiKey);
      if (!agent || agent.id !== req.params.agentId) {
        return res.status(403).json({ error: 'Forbidden' });
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
    console.error('GET /api/agents/:agentId/history', error);
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
router.get('/:agentId/key', verifyToken, async (req, res) => {
  try {
    const agents = await AgentService.list(req.user.userId);
    const agent = agents.find(a => a.id === req.params.agentId);
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
    console.error('GET /api/agents/:agentId/key', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
