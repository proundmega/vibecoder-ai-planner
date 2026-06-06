const express = require('express');
const router = express.Router();
const { verifyToken, requireRole } = require('../middleware/auth');
const { pool } = require('../db');
const ProjectService = require('../services/ProjectService');
const TicketService = require('../services/TicketService');

// List all projects for user
router.get('/', async (req, res) => {
  try {
    const { limit, offset, search } = req.query;
    const projects = await ProjectService.list(req.user.userId);
    res.json(projects);
  } catch (error) {
    console.error('GET /api/projects', error);
    res.status(500).json({ error: error.message });
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
    console.error('POST /api/projects', error);
    res.status(400).json({ error: error.message });
  }
});

// Get project tickets
router.get('/:id/tickets', async (req, res) => {
  try {
    const tickets = await TicketService.findByProject(req.params.id, req.user.userId);
    res.json(tickets);
  } catch (error) {
    console.error('GET /api/projects/:id/tickets', error);
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
    console.error('GET /api/projects/:id/tickets/status/:status', error);
    res.status(400).json({ error: error.message });
  }
});

// Get project memberships
router.get('/:id/members', async (req, res) => {
  try {
    const memberships = await ProjectService.getMemberships(req.params.id);
    res.json(memberships);
  } catch (error) {
    console.error('GET /api/projects/:id/members', error);
    res.status(404).json({ error: 'Project not found' });
  }
});

// Get users who can be assigned to tickets in this project
router.get('/:id/users', async (req, res) => {
  try {
    await ProjectService.getOne(req.params.id, req.user.userId);
    
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.role 
       FROM users u 
       WHERE u.id != $1 
       ORDER BY u.name NULLS FIRST, u.email`,
      [req.user.userId]
    );
    
    res.json({ users: result.rows });
  } catch (error) {
    console.error('GET /api/projects/:id/users', error);
    res.status(404).json({ error: 'Project not found' });
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
    console.error('GET /api/projects/:id', error);
    res.status(404).json({ error: 'Project not found' });
  }
});

// Update project
router.put('/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    const project = await ProjectService.update(req.params.id, { name, description }, req.user.userId);
    res.json(project);
  } catch (error) {
    console.error('PUT /api/projects/:id', error);
    if (error.message === 'Project not found') {
      return res.status(404).json({ error: 'Project not found' });
    }
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
    console.error('POST /api/projects/:id/tickets/:ticketId/status', error);
    res.status(400).json({ error: error.message });
  }
});

// Create ticket
router.post('/:id/tickets', async (req, res) => {
  try {
    const { title, description, priority } = req.body;
    const ticket = await TicketService.create(req.params.id, title, description, priority, req.user.userId);
    res.status(201).json(ticket);
  } catch (error) {
    console.error('POST /api/projects/:id/tickets', error);
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
    console.error('PUT /api/projects/tickets/:ticketId', error);
    res.status(400).json({ error: error.message });
  }
});

// Delete ticket (admin/member: any ticket, user: own ticket only)
router.delete('/tickets/:ticketId', verifyToken, requireRole('project_admin', 'member', 'user'), async (req, res) => {
  try {
    await TicketService.delete(req.params.ticketId, req.user.userId);
    res.json({ message: 'Ticket deleted' });
  } catch (error) {
    console.error('DELETE /api/projects/tickets/:ticketId', error);
    if (error.message === 'Ticket not found') {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    if (error.message === 'Forbidden') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    res.status(400).json({ error: error.message });
  }
});

// Delete project
router.delete('/:id', async (req, res) => {
  try {
    await ProjectService.delete(req.params.id, req.user.userId);
    res.json({ message: 'Project deleted' });
  } catch (error) {
    console.error('DELETE /api/projects/:id', error);
    if (error.message === 'Project not found') {
      return res.status(404).json({ error: 'Project not found' });
    }
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;
