const express = require('express');
const router = express.Router();
const HeartbeatService = require('../../services/HeartbeatService');
const AgentService = require('../../services/AgentService');
const { verifyToken } = require('../../middleware/auth');

// POST /api/v1/agents/:id/heartbeat — agent-side auth via X-API-Key
router.post('/:id/heartbeat', async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      return res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'X-API-Key header required' } });
    }
    const agent = await AgentService.getAgentByApiKey(apiKey);
    if (!agent || agent.id !== Number(req.params.id)) {
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
    console.error('POST /agents/:id/heartbeat', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// GET /api/v1/agents — list all agents with status
router.get('/', verifyToken, async (req, res) => {
  try {
    const agents = await HeartbeatService.getAllAgents();
    res.json({ success: true, data: agents });
  } catch (error) {
    console.error('GET /agents', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

// GET /api/v1/agents/:id — agent detail
router.get('/:id', verifyToken, async (req, res) => {
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
    console.error('GET /agents/:id', error);
    res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: error.message } });
  }
});

module.exports = router;
