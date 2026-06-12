const express = require('express');
const router = express.Router();
const { requireAnyPermission, requireAllPermissions } = require('../middleware/permissions');
const { verifyToken, verifyTokenOrAgent } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema } = require('../validators/tickets');
const ticketController = require('../controllers/ticketController');

// Create new ticket
router.post('/', verifyToken, requireAnyPermission('TICKET_CREATE'), validate(createTicketSchema), ticketController.createTicket);

// Get tickets for a project (MUST be before /:ticketId routes)
router.get('/project/:projectId', verifyTokenOrAgent, ticketController.getProjectTickets);

// Agent-specific routes (MUST be before /:ticketId to avoid route collision)
router.post('/:ticketId/status', verifyTokenOrAgent, requireAnyPermission('TICKET_STATUS_CHANGE'), validate(statusTransitionSchema), ticketController.changeStatus);
router.post('/:ticketId/pickup', verifyTokenOrAgent, ticketController.pickUpTicket);
router.post('/:ticketId/release', verifyTokenOrAgent, ticketController.releaseTicket);

// Get comments for a ticket (MUST be before /:ticketId to avoid route collision)
router.get('/:ticketId/comments', verifyToken, ticketController.getTicketComments);

// Get single ticket
router.get('/:ticketId', verifyTokenOrAgent, ticketController.getTicket);

// Update ticket (partial updates supported)
router.put('/:ticketId', verifyTokenOrAgent, requireAnyPermission('TICKET_UPDATE'), validate(updateTicketSchema), ticketController.updateTicket);

// Delete ticket (permission + ownership checked in service)
router.delete('/:ticketId', verifyToken, ticketController.deleteTicket);

// Add a comment to a ticket
router.post('/:ticketId/comments', verifyToken, requireAnyPermission('TICKET_COMMENT'), validate(commentSchema), ticketController.addComment);

// Get messages for a ticket
router.get('/:ticketId/messages', verifyTokenOrAgent, ticketController.getMessages);

// Post a message on a ticket
router.post('/:ticketId/messages', verifyTokenOrAgent, ticketController.postMessage);

module.exports = router;
