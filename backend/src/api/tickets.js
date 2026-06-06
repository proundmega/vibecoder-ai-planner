const express = require('express');
const router = express.Router();
const { requireRole, verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema } = require('../validators/tickets');
const ticketController = require('../controllers/ticketController');

// Get single ticket
router.get('/:ticketId', ticketController.getTicket);

// Create new ticket
router.post('/', verifyToken, validate(createTicketSchema), ticketController.createTicket);

// Update ticket (partial updates supported)
router.put('/:ticketId', verifyToken, validate(updateTicketSchema), ticketController.updateTicket);

// Delete ticket
router.delete('/:ticketId', verifyToken, requireRole('project_admin', 'member'), ticketController.deleteTicket);

// Get tickets for a project
router.get('/project/:projectId', ticketController.getProjectTickets);

// Get comments for a ticket
router.get('/:ticketId/comments', ticketController.getTicketComments);

// Add a comment to a ticket
router.post('/:ticketId/comments', verifyToken, validate(commentSchema), ticketController.addComment);

// Change ticket status
router.post('/:ticketId/status', verifyToken, validate(statusTransitionSchema), ticketController.changeStatus);

module.exports = router;
