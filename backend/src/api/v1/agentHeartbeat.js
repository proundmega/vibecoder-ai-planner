const express = require('express');
const router = express.Router();
const HeartbeatService = require('../../services/HeartbeatService');
const AgentService = require('../../services/AgentService');
const { verifyToken } = require('../../middleware/auth');
const logger = require('../../utils/logger');

/**
 * @openapi
 * /agents-status/{id}/heartbeat:
 *   post:
 *     tags: [Agents]
 *     summary: Record agent heartbeat
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     headers:
 *       X-API-Key:
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               current_ticket_id: { type: integer }
 *               current_step: { type: string }
 *               memory_usage: { type: number }
 *               cpu_usage: { type: number }
 *     responses:
 *       200:
 *         description: Heartbeat recorded
 *       401:
 *         description: Missing API key
 *       403:
 *         description: Invalid API key
 */
router.post('/:id/heartbeat', async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'X-API-Key header required' } });
    }
    const agent = await AgentService.getAgentByApiKey(apiKey);
    if (!agent || String(agent.id) !== String(req.params.id)) {
      return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Invalid API key for this agent' } });
    }
    const { current_ticket_id, current_step, memory_usage, cpu_usage } = req.body;
    await HeartbeatService.recordHeartbeat(agent.id, {
      ticketId: current_ticket_id,
      step: current_step,
      memory: memory_usage,
      cpu: cpu_usage,
    });
    res.json({ success: true });
  } catch (error) {
    logger.error('POST /agents/:id/heartbeat failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /agents-status:
 *   get:
 *     tags: [Agents]
 *     summary: List all agents with status
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of agents
 */
router.get('/', verifyToken, async (req, res, next) => {
  try {
    const agents = await HeartbeatService.getAllAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    logger.error('GET /agents failed:', error);
    next(error);
  }
});

/**
 * @openapi
 * /agents-status/{id}:
 *   get:
 *     tags: [Agents]
 *     summary: Get agent detail
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Agent detail
 *       404:
 *         description: Agent not found
 */
router.get('/:id', verifyToken, async (req, res, next) => {
  try {
    const agent = await HeartbeatService.getAgentStatus(req.params.id);
    if (!agent) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } });
    }
    const history = await AgentService.getAgentHistory(agent.agent_id, 100);
    const totalActions = history.length;
    const totalCost = history.reduce((sum, a) => sum + (a.cost_incurred || 0), 0);
    res.json({
      success: true,
      data: {
        ...agent,
        history,
        totalActions,
        totalCost,
      },
    });
  } catch (error) {
    logger.error('GET /agents/:id failed:', error);
    next(error);
  }
});

module.exports = router;
