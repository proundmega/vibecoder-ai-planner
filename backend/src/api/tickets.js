const express = require('express');
const router = express.Router();
const { requireRole, verifyToken } = require('../middleware/auth');
const TicketService = require('../services/TicketService');
const User = require('../models/user');
const ApprovalService = require('../services/ApprovalService');

// Get single ticket
router.get('/:ticketId', async (req, res) => {
  try {
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    res.json(ticket);
  } catch (error) {
    console.error('GET /api/tickets/:ticketId', error);
    res.status(404).json({ error: error.message });
  }
});

// Create new ticket
router.post('/', async (req, res) => {
  try {
    const { projectId, title, description, priority } = req.body;
    const ticket = await TicketService.create(projectId, title, description, priority, req.user.userId);
    res.status(201).json(ticket);
  } catch (error) {
    console.error('POST /api/tickets', error);
    res.status(400).json({ error: error.message });
  }
});

// Update ticket
router.put('/:ticketId', async (req, res) => {
  try {
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    const user = await User.find(req.user.userId);
    
    // 'user' role (AI agents) can only update their own tickets
    if (user.role === 'user' && ticket.owner_id !== req.user.userId) {
      return res.status(403).json({ error: 'AI agents can only update their own tickets' });
    }
    
    const { title, description, status, priority, assigneeId } = req.body;
    await TicketService.update(
      req.params.ticketId,
      { title, description, status, priority, assigneeId },
      req.user.userId
    );
    res.json({ message: 'Ticket updated' });
  } catch (error) {
    console.error('PUT /api/tickets/:ticketId', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete ticket
router.delete('/:ticketId', verifyToken, requireRole('project_admin', 'member'), async (req, res) => {
  try {
    await TicketService.delete(req.params.ticketId, req.user.userId);
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    console.error('DELETE /api/tickets/:ticketId', error);
    res.status(404).json({ error: error.message });
  }
});

// Get tickets for a project
router.get('/project/:projectId', async (req, res) => {
  try {
    const tickets = await TicketService.findByProject(req.params.projectId, req.user.userId);
    res.json(tickets);
  } catch (error) {
    console.error('GET /api/tickets/project/:projectId', error);
    res.status(400).json({ error: error.message });
  }
});

// Get comments for a ticket
router.get('/:ticketId/comments', async (req, res) => {
  try {
    const comments = await TicketService.getComments(req.params.ticketId, req.user.userId);
    res.json(comments);
  } catch (error) {
    console.error('GET /api/tickets/:ticketId/comments', error);
    res.status(404).json({ error: error.message });
  }
});

// Add a comment to a ticket
router.post('/:ticketId/comments', async (req, res) => {
  try {
    const { content } = req.body;
    const comment = await TicketService.addComment(req.params.ticketId, content, req.user.userId);
    res.status(201).json(comment);
  } catch (error) {
    console.error('POST /api/tickets/:ticketId/comments', error);
    res.status(400).json({ error: error.message });
  }
});

// Change ticket status
router.post('/:ticketId/status', verifyToken, async (req, res) => {
  try {
    const { status } = req.body;
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    const user = await User.find(req.user.userId);
    
    if (user.role === 'user' && status === 'done') {
      if (ticket.status !== 'review') {
        return res.status(400).json({ 
          error: 'AI agents can only submit for review, not mark as done' 
        });
      }
      
      const approval = await ApprovalService.create(req.params.ticketId, req.user.userId);
      return res.json({ 
        message: 'Approval request submitted. Awaiting review.',
        approval 
      });
    }
    
    await TicketService.updateStatus(req.params.ticketId, status, req.user.userId);
    res.json({ message: 'Status updated', status });
  } catch (error) {
    console.error('POST /api/tickets/:ticketId/status', error);
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
