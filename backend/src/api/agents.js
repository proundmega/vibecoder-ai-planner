const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const TicketService = require('../services/TicketService');
const ProjectService = require('../services/ProjectService');
const AgentService = require('../services/AgentService');
const { verifyToken } = require('../middleware/auth');

/**
 * AI Agent API Endpoints
 * Usage: Add X-API-Key header for agent operations without user auth
 */

// ==================== USER-FACING AGENT ENDPOINTS ====================

// Create a new agent for user
router.post('/agents/create', verifyToken, async (req, res) => {
  try {
    const { name } = req.body;
    
    // Generate a random API key
    const apiKey = `ak_${crypto.randomBytes(24).toString('hex')}`;
    
    const agent = await AgentService.create(name, apiKey, req.user.userId);
    
    res.status(201).json({
      ...agent,
      generatedApiKey: apiKey
    });
  } catch (error) {
    console.error('POST /api/agents/create', error);
    res.status(400).json({ error: error.message });
  }
});

// List user's agents
router.get('/agents', verifyToken, async (req, res) => {
  try {
    const agents = await AgentService.list(req.user.id);
    res.json({ agents });
  } catch (error) {
    console.error('GET /api/agents', error);
    res.status(500).json({ error: error.message });
  }
});

// Revoke an agent's API key
router.post('/agents/revoke/:agentId', verifyToken, async (req, res) => {
  try {
    await AgentService.revokeApiKey(req.params.agentId);
    res.json({ message: 'API key revoked' });
  } catch (error) {
    console.error('POST /api/agents/revoke/:agentId', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete agent
router.delete('/agents/:agentId', verifyToken, async (req, res) => {
  try {
    await AgentService.delete(req.params.agentId);
    res.json({ message: 'Agent deleted' });
  } catch (error) {
    console.error('DELETE /api/agents/:agentId', error);
    res.status(400).json({ error: error.message });
  }
});

// ==================== AGENT-OPTIONAL ENDPOINTS (X-API-Key) ====================
// These endpoints accept either user auth OR agent auth via x-api-key

async function agentAuthMiddleware(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  
  if (apiKey) {
    // Validate agent API key
    try {
      const agent = await AgentService.getAgentByApiKey(apiKey);
      if (!agent) {
        return res.status(401).json({ error: 'Invalid API key' });
      }
      
      // Check daily limit
      const dailyUsage = await AgentService.getAgentDailyLimit(agent.id);
      if (dailyUsage.used >= dailyUsage.limit) {
        return res.status(429).json({ 
          error: 'Rate limit exceeded. Try again tomorrow.',
          resetAt: dailyUsage.resetAt
        });
      }
      
      res.locals.agent = agent;
      res.locals.dailyUsage = dailyUsage;
      return next();
    } catch (error) {
      console.error('agentAuthMiddleware:', error);
      return res.status(500).json({ error: 'Invalid agent credentials' });
    }
  } else {
    // No API key provided, continue without agent context
    return next();
  }
}

// Create ticket via API
router.post('/tickets/create', agentAuthMiddleware, async (req, res) => {
  try {
    // Check if authenticated as agent
    if (!res.locals.agent) {
      if (!req.headers.authorization) {
        return res.status(401).json({ error: 'Authentication required. Use user token or agent API key.' });
      }
      // User-created ticket via standard user auth
      const { projectId, title, description, tags } = req.body;
      
      const ticket = await TicketService.create(projectId, title, description, req.user.id);
      
      // Track action if agent is present
      if (res.locals.agent?.id) {
        await AgentService.registerAction(
          res.locals.agent.id,
          'create_ticket',
          'tickets',
          ticket.id
        );
      }
      
      res.status(201).json({
        ...ticket,
        apiSource: res.locals.agent?.name || 'User',
        createdAt: new Date().toISOString()
      });
    } else {
      // Agent-created ticket
      const { projectId, title, description, tags } = req.body;
      
      const ticket = await TicketService.create(projectId, title, description, res.locals.agent.id);
      
      await AgentService.registerAction(
        res.locals.agent.id,
        'create_ticket',
        'tickets',
        ticket.id
      );
      
      res.status(201).json({
        ...ticket,
        agentAssigned: res.locals.agent.name,
        createdAt: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('POST /api/tickets/create', error);
    res.status(400).json({ error: error.message });
  }
});

// Edit existing ticket
router.post('/tickets/edit/:ticketId', agentAuthMiddleware, async (req, res) => {
  try {
    if (!res.locals.agent) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    const { title, description, status, priority, tags } = req.body;
    
    await TicketService.update(
      req.params.ticketId,
      { title, description, status, priority },
      res.locals.agent.id
    );
    
    await AgentService.registerAction(
      res.locals.agent.id,
      'update_ticket',
      'tickets',
      req.params.ticketId
    );
    
    res.json({
      message: 'Ticket updated',
      updatedBy: res.locals.agent.name,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('POST /api/tickets/edit/:ticketId', error);
    res.status(400).json({ error: error.message });
  }
});

// Claim (assign) ticket to agent
router.post('/tickets/claim/:ticketId', agentAuthMiddleware, async (req, res) => {
  try {
    if (!res.locals.agent) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    const ticket = await TicketService.claim(req.params.ticketId, res.locals.agent.id);
    
    await AgentService.registerAction(
      res.locals.agent.id,
      'claim_ticket',
      'tickets',
      req.params.ticketId
    );
    
    res.json({
      ...ticket,
      claimedBy: res.locals.agent.name,
      status: 'in_progress'
    });
  } catch (error) {
    console.error('POST /api/tickets/claim/:ticketId', error);
    res.status(400).json({ error: error.message });
  }
});

// Change ticket status (agent workflow)
router.post('/tickets/status/:ticketId', agentAuthMiddleware, async (req, res) => {
  try {
    if (!res.locals.agent) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    const { status } = req.body;
    
    await TicketService.updateStatus(
      req.params.ticketId,
      status,
      res.locals.agent.id
    );
    
    await AgentService.registerAction(
      res.locals.agent.id,
      'status_change',
      'tickets',
      req.params.ticketId,
      { status }
    );
    
    res.json({
      message: 'Status changed',
      oldStatus: req.body.status,
      newStatus: status,
      byAgent: res.locals.agent.name
    });
  } catch (error) {
    console.error('POST /api/tickets/status/:ticketId', error);
    res.status(400).json({ error: error.message });
  }
});

// Get agent's assigned tickets
router.get('/tickets/my-tasks/:projectId', agentAuthMiddleware, async (req, res) => {
  try {
    if (!res.locals.agent) {
      return res.status(401).json({ 
        error: 'Authentication required' 
      });
    }

    const tickets = await AgentService.getAgentTickets(
      res.locals.agent.id,
      req.params.projectId
    );
    
    res.json({
      tickets,
      count: tickets.length,
      lastActive: new Date().toISOString(),
      agent: res.locals.agent.name
    });
  } catch (error) {
    console.error('GET /api/tickets/my-tasks/:projectId', error);
    res.status(404).json({ error: error.message });
  }
});

// Update daily usage counter when actions are registered
async function registerAgentAction(agentId, actionType, metadata) {
  // Increment usage (simplified - use registerAction for proper tracking)
  return await AgentService.registerAction(agentId, actionType, 'unknown', null);
}

// Get agent's activity history
router.get('/agents/:agentId/history', agentAuthMiddleware, async (req, res) => {
  try {
    if (!res.locals.agent || res.locals.agent.id !== req.params.agentId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const history = await AgentService.getAgentHistory(res.locals.agent.id, 100);
    
    // Aggregate by date for the summary
    const dailySummary = history.reduce((acc, action) => {
      const date = action.created_at.split('T')[0];
      if (!acc[date]) {
        acc[date] = { count: 0, totalCost: 0, actions: [] };
      }
      acc[date].count++;
      acc[date].totalCost += action.cost_incurred || 0.05;
      acc[date].actions.push({
        type: action.action_type,
        timestamp: action.created_at
      });
      return acc;
    }, {});
    
    res.json({
      agentName: res.locals.agent.name,
      totalActions: history.length,
      totalCost: history.reduce((sum, a) => sum + (a.cost_incurred || 0), 0),
      daily: Object.keys(dailySummary).map(date => ({
        date,
        count: dailySummary[date].count,
        totalCost: dailySummary[date].totalCost
      }))
    });
  } catch (error) {
    console.error('GET /api/agents/:agentId/history', error);
    res.status(500).json({ error: error.message });
  }
});

// Get agent API key info (without the actual key for security)
router.get('/agents/:agentId/key', verifyToken, async (req, res) => {
  try {
    const agents = await AgentService.list(req.user.id);
    const agent = agents.find(a => a.id === req.params.agentId);
    
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    // Don't expose the full API key for security
    res.json({
      name: agent.name,
      keyPreview: agent.api_key ? agent.api_key.substring(0, 8) + '***' : 'None',
      rateLimit: agent.rate_limit,
      maxActionsPerDay: agent.max_actions_per_day
    });
  } catch (error) {
    console.error('GET /api/agents/:agentId/key', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
