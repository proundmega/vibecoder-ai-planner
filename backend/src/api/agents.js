const express = require('express');
const router = express.Router();
const TicketService = require('../services/TicketService');
const ProjectService = require('../services/ProjectService');
const { requireRole, verifyToken } = require('../middleware/auth');

/**
 * AI Agent API Endpoints
 * Usage: Add X-API-Key header with your agent key
 */

// Create ticket via API
router.post('/tickets/create', verifyToken, async (req, res) => {
  try {
    const { projectId, title, description, tags } = req.body;
    
    const ticket = await TicketService.create(projectId, title, description, req.agent.id);
    
    res.status(201).json({
      ...ticket,
      apiSource: req.agent.name,
      createdAt: new Date().toISOString()
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Edit existing ticket
router.post('/tickets/edit/:ticketId', verifyToken, async (req, res) => {
  try {
    const { title, description, status, priority, tags } = req.body;
    
    await TicketService.update(
      req.params.ticketId,
      { title, description, status, priority },
      req.agent.id
    );
    
    res.json({
      message: 'Ticket updated',
      updatedBy: req.agent.name,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Claim (assign) ticket to agent
router.post('/tickets/claim/:ticketId', verifyToken, async (req, res) => {
  try {
    const ticket = await TicketService.claim(req.params.ticketId, req.agent.id);
    
    res.json({
      ...ticket,
      claimedBy: req.agent.name,
      status: 'in_progress'
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Change ticket status (agent workflow)
router.post('/tickets/status/:ticketId', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    
    await TicketService.updateStatus(
      req.params.ticketId,
      status,
      req.agent.id
    );
    
    res.json({
      message: 'Status changed',
      oldStatus: req.body.status,
      newStatus: status,
      byAgent: req.agent.name
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get agent's assigned tickets
router.get('/tickets/my-tasks', verifyToken, async (req, res) => {
  try {
    // In production, filter by assignee_id or custom agent assignment field
    const tickets = await TicketService.findByProject(
      req.params.projectId,
      req.agent.id
    );
    
    res.json({
      tickets,
      count: tickets.length,
      lastActive: new Date().toISOString()
    });
  } catch (error) {
    res.status(404).json({ error: error.message });
  }
});

// Get agent's activity history
router.get('/agent/history', verifyToken, async (req, res) => {
  try {
    res.json({
      agentName: req.agent.name,
      actions: [
        { 
          id: '1', 
          type: 'create', 
          ticketId: 'TKT-001', 
          timestamp: '2024-01-15T10:30:00Z' 
        },
        { 
          id: '2', 
          type: 'update_status', 
          ticketId: 'TKT-002', 
          from: 'backlog', 
          to: 'in_progress', 
          timestamp: '2024-01-15T11:45:00Z' 
        }
      ]
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
