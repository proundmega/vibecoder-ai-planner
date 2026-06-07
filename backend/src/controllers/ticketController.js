const TicketService = require('../services/TicketService');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const ApprovalService = require('../services/ApprovalService');

async function getTicket(req, res, next) {
  try {
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    res.json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

async function createTicket(req, res, next) {
  try {
    const { projectId, title, description, priority } = req.body;
    const ticket = await TicketService.create(projectId, title, description, priority, req.user.userId);
    res.status(201).json({ success: true, data: ticket });
  } catch (error) {
    next(error);
  }
}

async function updateTicket(req, res, next) {
  try {
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    const user = await User.find(req.user.userId);
    
    const canUpdate = await PermissionService.hasPermission(user.role, 'TICKET_UPDATE');
    if (!canUpdate && ticket.owner_id !== req.user.userId) {
      return res.status(403).json({ 
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'AI agents can only update their own tickets',
        },
      });
    }
    
    const allowedFields = ['title', 'description', 'status', 'priority', 'assigneeId'];
    const filteredUpdates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        filteredUpdates[field] = req.body[field];
      }
    }
    
    await TicketService.update(req.params.ticketId, filteredUpdates, req.user.userId);
    res.json({ success: true, data: { message: 'Ticket updated' } });
  } catch (error) {
    next(error);
  }
}

async function deleteTicket(req, res, next) {
  try {
    await TicketService.delete(req.params.ticketId, req.user.userId);
    res.json({ success: true, data: { message: 'Ticket deleted' } });
  } catch (error) {
    next(error);
  }
}

async function getProjectTickets(req, res, next) {
  try {
    const tickets = await TicketService.findByProject(req.params.projectId, req.user.userId);
    res.json({ success: true, data: tickets });
  } catch (error) {
    next(error);
  }
}

async function getTicketComments(req, res, next) {
  try {
    const comments = await TicketService.getComments(req.params.ticketId, req.user.userId);
    res.json({ success: true, data: comments });
  } catch (error) {
    next(error);
  }
}

async function addComment(req, res, next) {
  try {
    const { content } = req.body;
    const comment = await TicketService.addComment(req.params.ticketId, content, req.user.userId);
    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    next(error);
  }
}

async function changeStatus(req, res, next) {
  try {
    const { status } = req.body;
    const ticket = await TicketService.getOne(req.params.ticketId, req.user.userId);
    const user = await User.find(req.user.userId);
    
    const canChangeStatus = await PermissionService.hasPermission(user.role, 'TICKET_STATUS_CHANGE');
    if (user.role === 'user' && status === 'done' && canChangeStatus) {
      if (ticket.status !== 'review') {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_STATUS',
            message: 'AI agents can only submit for review, not mark as done',
          },
        });
      }
      
      const approval = await ApprovalService.create(req.params.ticketId, req.user.userId);
      return res.json({ 
        success: true,
        data: { message: 'Approval request submitted. Awaiting review.', approval },
      });
    }
    
    await TicketService.updateStatus(req.params.ticketId, status, req.user.userId);
    res.json({ success: true, data: { message: 'Status updated', status } });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getTicket,
  createTicket,
  updateTicket,
  deleteTicket,
  getProjectTickets,
  getTicketComments,
  addComment,
  changeStatus,
};
