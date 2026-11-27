const { requireAnyPermission } = require('./permissions');
const Ticket = require('../models/ticket');
const TicketService = require('../services/TicketService');

const statusChangePermission = requireAnyPermission('TICKET_STATUS_CHANGE');

/**
 * Human-only guard for routes that also accept agent credentials.
 *
 * `verifyTokenOrAgent` populates `req.user` for agent requests too, so the
 * permission check must only run for a real JWT caller.
 */
function requireHumanStatusPermission(req, res, next) {
  if (req.agent || !req.user) return next();
  return statusChangePermission(req, res, next);
}

/**
 * Human callers must be members of the ticket's project. Agent callers are
 * already covered by the runtime/ticket grant middleware.
 */
async function requireHumanProjectMembership(req, res, next) {
  if (req.agent || !req.user) return next();
  try {
    const ticket = await Ticket.findById(req.params.ticketId);
    if (!ticket) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Ticket not found' },
      });
    }
    const allowed = await TicketService.canActOnTicketProject(ticket, {
      operatorId: req.user.userId ?? req.user.id,
      role: req.user.role,
    });
    if (!allowed) {
      return res.status(403).json({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Unauthorized to act on this ticket project',
        },
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  requireHumanStatusPermission,
  requireHumanProjectMembership,
};
