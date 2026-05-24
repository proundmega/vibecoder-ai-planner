const express = require('express');
const router = express.Router();
const TicketService = require('../services/TicketService');

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
router.delete('/:ticketId', async (req, res) => {
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

module.exports = router;
