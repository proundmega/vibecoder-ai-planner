const TicketService = require('../services/TicketService');
const { ForbiddenError } = require('../errors/HttpError');

/**
 * Middleware to enforce ticket ownership.
 * Only the assigned agent or a project_admin/super_admin can modify the ticket.
 */
async function requireTicketOwnership(req, res, next) {
  try {
    const { id } = req.params;
    const userId = req.user.userId;
    const userRole = req.user.role;

    // Admins bypass ownership check
    if (userRole === 'project_admin' || userRole === 'super_admin') {
      return next();
    }

    await TicketService.enforceOwnership(id, userId);
    next();
  } catch (error) {
    if (error instanceof ForbiddenError) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'TICKET_LOCKED',
          message: error.message,
        },
      });
    }
    next(error);
  }
}

/**
 * Middleware to get the ticket and attach it to the request.
 */
async function getTicket(req, res, next) {
  try {
    const { id } = req.params;
    const Ticket = require('../models/ticket');
    const ticket = await Ticket.findById(id);

    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Ticket not found',
        },
      });
    }

    req.ticket = ticket;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = { requireTicketOwnership, getTicket };
