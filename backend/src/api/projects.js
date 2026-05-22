const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/auth');
const ProjectService = require('../services/ProjectService');
const TicketService = require('../services/TicketService');

// List all projects for user
router.get('/', async (req, res) => {
  try {
    const { limit, offset, search } = req.query;
    const projects = await ProjectService.list(req.user.userId);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single project
router.get('/:id', async (req, res) => {
  try {
    const project = await ProjectService.getOne(req.params.id, req.user.userId);
    const tickets = await TicketService.findByProject(project.id, req.user.userId);
    
    res.json({
      ...project,
      ticketCount: tickets.length,
      ticketIds: tickets.map(t => t.id)
    });
  } catch (error) {
    res.status(404).json({ error: 'Project not found' });
  }
});

// Create new project
router.post('/', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const project = await ProjectService.create(name, description, req.user.userId);
    res.status(201).json(project);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get project tickets
router.get('/:id/tickets', async (req, res) => {
  try {
    const tickets = await TicketService.findByProject(req.params.id, req.user.userId);
    res.json(tickets);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get ticket by status
router.get('/:id/tickets/status/:status', async (req, res) => {
  try {
    const tickets = await TicketService.findByStatus(
      req.params.id, 
      req.params.status.toLowerCase(),
      req.user.userId
    );
    res.json(tickets);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update ticket status
router.post('/:id/tickets/:ticketId/status', async (req, res) => {
  try {
    const { status } = req.body;
    await TicketService.updateStatus(req.params.ticketId, status, req.user.userId);
    res.json({ 
      message: 'Ticket status updated', 
      status
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Create ticket
router.post('/:id/tickets', async (req, res) => {
  try {
    const { title, description, priority } = req.body;
    const ticket = await TicketService.create(req.params.id, title, description, req.user.userId);
    res.status(201).json(ticket);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Update ticket
router.put('/tickets/:ticketId', async (req, res) => {
  try {
    const { title, description, status, priority, assigneeId } = req.body;
    await TicketService.update(req.params.ticketId, { title, description, status, priority, assigneeId }, req.user.userId);
    res.json({ message: 'Ticket updated', status: req.body.status });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Delete ticket
router.delete('/tickets/:ticketId', async (req, res) => {
  try {
    await TicketService.delete(req.params.ticketId, req.user.userId);
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    res.status(404).json({ error: 'Ticket not found' });
  }
});

// Get project memberships
router.get('/:id/members', async (req, res) => {
  try {
    const memberships = await ProjectService.getMemberships(req.params.id);
    res.json(memberships);
  } catch (error) {
    res.status(404).json({ error: 'Project not found' });
  }
});

module.exports = router;
