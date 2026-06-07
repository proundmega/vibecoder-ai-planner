const express = require('express');
const router = express.Router();
const { requireAnyPermission, requireAllPermissions } = require('../middleware/permissions');
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema } = require('../validators/tickets');
const ticketController = require('../controllers/ticketController');

// Get single ticket
router.get('/:ticketId', ticketController.getTicket);

// Create new ticket
router.post('/', verifyToken, requireAnyPermission('TICKET_CREATE'), validate(createTicketSchema), ticketController.createTicket);

// Update ticket (partial updates supported)
router.put('/:ticketId', verifyToken, requireAnyPermission('TICKET_UPDATE'), validate(updateTicketSchema), ticketController.updateTicket);

// Delete ticket (permission + ownership checked in service)
router.delete('/:ticketId', verifyToken, ticketController.deleteTicket);

// Get tickets for a project
router.get('/project/:projectId', ticketController.getProjectTickets);

// Get comments for a ticket
router.get('/:ticketId/comments', ticketController.getTicketComments);

// Add a comment to a ticket
router.post('/:ticketId/comments', verifyToken, requireAnyPermission('TICKET_COMMENT'), validate(commentSchema), ticketController.addComment);

// Change ticket status
router.post('/:ticketId/status', verifyToken, requireAnyPermission('TICKET_STATUS_CHANGE'), validate(statusTransitionSchema), ticketController.changeStatus);

module.exports = router;
