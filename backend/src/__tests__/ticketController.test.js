const ticketController = require('../controllers/ticketController');
const TicketService = require('../services/TicketService');
const User = require('../models/user');
const ApprovalService = require('../services/ApprovalService');
const PermissionService = require('../services/PermissionService');

jest.mock('../services/TicketService');
jest.mock('../models/user');
jest.mock('../services/ApprovalService');
jest.mock('../services/PermissionService');

describe('Ticket Controller', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockReq = {
      params: {},
      body: {},
      user: { userId: 'test-user-id', role: 'project_admin' },
    };
  });

  describe('getTicket', () => {
    it('should return ticket with success wrapper', async () => {
      const ticket = { id: '1', title: 'Test' };
      TicketService.getOne.mockResolvedValue(ticket);
      
      mockReq.params.ticketId = '1';
      await ticketController.getTicket(mockReq, mockRes, nextFn);
      
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: ticket });
      expect(TicketService.getOne).toHaveBeenCalledWith('1', 'test-user-id');
    });

    it('should pass error to next()', async () => {
      const error = new Error('Not found');
      TicketService.getOne.mockRejectedValue(error);
      
      mockReq.params.ticketId = '1';
      await ticketController.getTicket(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('createTicket', () => {
    it('should create ticket with success wrapper', async () => {
      const ticket = { id: '1', title: 'New Ticket' };
      TicketService.create.mockResolvedValue(ticket);
      
      mockReq.body = { projectId: 'proj-1', title: 'New Ticket', description: 'Test' };
      await ticketController.createTicket(mockReq, mockRes, nextFn);
      
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: ticket });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Invalid data');
      TicketService.create.mockRejectedValue(error);
      
      mockReq.body = { projectId: 'proj-1', title: 'New Ticket' };
      await ticketController.createTicket(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('updateTicket', () => {
    it('should update ticket with success wrapper', async () => {
      const ticket = { id: '1', owner_id: 'test-user-id' };
      const user = { role: 'project_admin' };
      TicketService.getOne.mockResolvedValue(ticket);
      User.find.mockResolvedValue(user);
      TicketService.update.mockResolvedValue();
      
      mockReq.params.ticketId = '1';
      mockReq.body = { title: 'Updated Title' };
      await ticketController.updateTicket(mockReq, mockRes, nextFn);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Ticket updated' },
      });
    });

    it('should reject AI agents updating others tickets', async () => {
      const ticket = { id: '1', owner_id: 'other-user' };
      const user = { role: 'user' };
      TicketService.getOne.mockResolvedValue(ticket);
      User.find.mockResolvedValue(user);
      
      mockReq.params.ticketId = '1';
      mockReq.user.role = 'user';
      await ticketController.updateTicket(mockReq, mockRes, nextFn);
      
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'AI agents can only update their own tickets',
        },
      });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Update failed');
      TicketService.getOne.mockRejectedValue(error);
      
      mockReq.params.ticketId = '1';
      await ticketController.updateTicket(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('deleteTicket', () => {
    it('should delete ticket with success wrapper', async () => {
      TicketService.delete.mockResolvedValue();
      
      mockReq.params.ticketId = '1';
      await ticketController.deleteTicket(mockReq, mockRes, nextFn);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Ticket deleted' },
      });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Delete failed');
      TicketService.delete.mockRejectedValue(error);
      
      mockReq.params.ticketId = '1';
      await ticketController.deleteTicket(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('getProjectTickets', () => {
    it('should return tickets with success wrapper', async () => {
      const tickets = [{ id: '1' }, { id: '2' }];
      TicketService.findByProject.mockResolvedValue(tickets);
      
      mockReq.params.projectId = 'proj-1';
      await ticketController.getProjectTickets(mockReq, mockRes, nextFn);
      
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: tickets });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Not found');
      TicketService.findByProject.mockRejectedValue(error);
      
      mockReq.params.projectId = 'proj-1';
      await ticketController.getProjectTickets(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('getTicketComments', () => {
    it('should return comments with success wrapper', async () => {
      const comments = [{ id: '1', content: 'Test' }];
      TicketService.getComments.mockResolvedValue(comments);
      
      mockReq.params.ticketId = '1';
      await ticketController.getTicketComments(mockReq, mockRes, nextFn);
      
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: comments });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Not found');
      TicketService.getComments.mockRejectedValue(error);
      
      mockReq.params.ticketId = '1';
      await ticketController.getTicketComments(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('addComment', () => {
    it('should add comment with success wrapper', async () => {
      const comment = { id: '1', content: 'New comment' };
      TicketService.addComment.mockResolvedValue(comment);
      
      mockReq.params.ticketId = '1';
      mockReq.body = { content: 'New comment' };
      await ticketController.addComment(mockReq, mockRes, nextFn);
      
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ success: true, data: comment });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Add failed');
      TicketService.addComment.mockRejectedValue(error);
      
      mockReq.params.ticketId = '1';
      mockReq.body = { content: 'New comment' };
      await ticketController.addComment(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });

  describe('changeStatus', () => {
    it('should update status with success wrapper', async () => {
      const ticket = { id: '1', status: 'in_progress' };
      const user = { role: 'project_admin' };
      TicketService.getOne.mockResolvedValue(ticket);
      User.find.mockResolvedValue(user);
      PermissionService.hasPermission.mockResolvedValue(true);
      TicketService.updateStatus.mockResolvedValue();
      
      mockReq.params.ticketId = '1';
      mockReq.body = { status: 'review' };
      await ticketController.changeStatus(mockReq, mockRes, nextFn);
      
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Status updated', status: 'review' },
      });
    });

    it('should create approval for AI agents submitting to review', async () => {
      const ticket = { id: '1', status: 'review' };
      const user = { role: 'user' };
      const approval = { id: '1' };
      TicketService.getOne.mockResolvedValue(ticket);
      User.find.mockResolvedValue(user);
      PermissionService.hasPermission.mockResolvedValue(true);
      ApprovalService.create.mockResolvedValue(approval);
      
      mockReq.params.ticketId = '1';
      mockReq.user.role = 'user';
      mockReq.body = { status: 'done' };
      await ticketController.changeStatus(mockReq, mockRes, nextFn);
      
      expect(ApprovalService.create).toHaveBeenCalledWith('1', 'test-user-id');
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        data: { message: 'Approval request submitted. Awaiting review.', approval },
      });
    });

    it('should reject AI agents marking as done from non-review', async () => {
      const ticket = { id: '1', status: 'in_progress' };
      const user = { role: 'user' };
      TicketService.getOne.mockResolvedValue(ticket);
      User.find.mockResolvedValue(user);
      PermissionService.hasPermission.mockResolvedValue(true);
      
      mockReq.params.ticketId = '1';
      mockReq.user.role = 'user';
      mockReq.body = { status: 'done' };
      await ticketController.changeStatus(mockReq, mockRes, nextFn);
      
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'AI agents can only submit for review, not mark as done',
        },
      });
    });

    it('should pass error to next()', async () => {
      const error = new Error('Status update failed');
      TicketService.getOne.mockRejectedValue(error);
      
      mockReq.params.ticketId = '1';
      mockReq.body = { status: 'review' };
      await ticketController.changeStatus(mockReq, mockRes, nextFn);
      
      expect(nextFn).toHaveBeenCalledWith(error);
    });
  });
});
