const express = require('express');
const router = express.Router();
const { requireAnyPermission, requireAllPermissions } = require('../middleware/permissions');
const { verifyToken } = require('../middleware/auth');
const { validate } = require('../middleware/validate');
const { createTicketSchema, updateTicketSchema, statusTransitionSchema, commentSchema } = require('../validators/tickets');
const ticketController = require('../controllers/ticketController');

// Get comments for a ticket (must be before /:ticketId to avoid route collision)
router.get('/:ticketId/comments', ticketController.getTicketComments);

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

// Add a comment to a ticket
router.post('/:ticketId/comments', verifyToken, requireAnyPermission('TICKET_COMMENT'), validate(commentSchema), ticketController.addComment);

// Change ticket status
router.post('/:ticketId/status', verifyToken, requireAnyPermission('TICKET_STATUS_CHANGE'), validate(statusTransitionSchema), ticketController.changeStatus);

// Agent: pick up a ticket
router.post('/:ticketId/pickup', verifyToken, ticketController.pickUpTicket);

// Agent: release a ticket (admin only)
router.post('/:ticketId/release', verifyToken, requireAnyPermission('PROJECT_MANAGE_MEMBERS'), ticketController.releaseTicket);

// Get messages for a ticket
router.get('/:ticketId/messages', ticketController.getMessages);

// Post a message on a ticket
router.post('/:ticketId/messages', verifyToken, ticketController.postMessage);

module.exports = router;
