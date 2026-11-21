const ticketController = require('../controllers/ticketController');
const TicketService = require('../services/TicketService');
const MessageService = require('../services/MessageService');
const PermissionService = require('../services/PermissionService');
const User = require('../models/user');
const ApprovalService = require('../services/ApprovalService');

jest.mock('../services/TicketService', () => {
  const actual = jest.requireActual('../services/TicketService');
  return {
    ...actual,
    pickUpTicket: jest.fn(),
    releaseTicket: jest.fn(),
    getOne: jest.fn(),
    update: jest.fn(),
    updateStatus: jest.fn(),
  };
});

jest.mock('../services/MessageService', () => ({
  postMessage: jest.fn(),
  getTicketMessages: jest.fn(),
  getUnreadMessages: jest.fn(),
}));

jest.mock('../models/user', () => ({
  find: jest.fn(),
}));
jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn(),
}));
jest.mock('../services/ApprovalService', () => ({
  create: jest.fn(),
}));

describe('TicketController - Agent Orchestration', () => {
  let req, res, nextFn;

  beforeEach(() => {
    jest.clearAllMocks();
    nextFn = jest.fn();
    req = {
      params: {},
      user: { userId: 1, role: 'project_admin' },
      body: {},
      query: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
  });

  describe('pickUpTicket', () => {
    test('should pick up a ticket for the node runtime', async () => {
      const mockTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'in_progress',
        assigned_runtime_id: 3,
        locked_at: new Date(),
      };

      TicketService.pickUpTicket.mockResolvedValueOnce(mockTicket);

      req.params.ticketId = '100';
      req.agent = { id: 12, owner_id: 1, _node: true };
      req.runtime = { id: 3 };

      await ticketController.pickUpTicket(req, res);

      expect(TicketService.pickUpTicket).toHaveBeenCalledWith('100', {
        runtimeId: 3,
        operatorId: 1,
      });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: 100,
          title: 'Test Ticket',
          status: 'in_progress',
          assignedRuntimeId: 3,
          lockedAt: expect.any(Date),
        },
      });
    });

    test('should reject a JWT request that has no runtime identity', async () => {
      req.params.ticketId = '100';

      await ticketController.pickUpTicket(req, res);

      expect(TicketService.pickUpTicket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Node runtime credentials required to pick up a ticket',
        },
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Ticket not found');
      TicketService.pickUpTicket.mockRejectedValueOnce(mockError);

      req.params.ticketId = '100';
      req.agent = { id: 12, owner_id: 1, _node: true };
      req.runtime = { id: 3 };

      const next = jest.fn();
      await ticketController.pickUpTicket(req, res, next);

      expect(next).toHaveBeenCalledWith(mockError);
    });
  });

  describe('releaseTicket', () => {
    test('should release as an operator with PROJECT_UPDATE', async () => {
      const mockTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'backlog',
        assigned_runtime_id: null,
        locked_at: null,
      };

      TicketService.releaseTicket.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      req.params.ticketId = '100';

      await ticketController.releaseTicket(req, res);

      expect(PermissionService.hasPermission).toHaveBeenCalledWith('project_admin', 'PROJECT_UPDATE');
      expect(TicketService.releaseTicket).toHaveBeenCalledWith('100', { operatorId: 1, role: 'project_admin' });
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: 100,
          title: 'Test Ticket',
          status: 'backlog',
          assignedRuntimeId: null,
          lockedAt: null,
        },
      });
    });

    test('should release as the assigned runtime and return the assigned runtime', async () => {
      TicketService.releaseTicket.mockResolvedValueOnce({
        id: 100,
        title: 'Test Ticket',
        status: 'backlog',
        assigned_runtime_id: null,
        locked_at: null,
      });

      req.params.ticketId = '100';
      req.agent = { id: 12, owner_id: 1, _node: true };
      req.runtime = { id: 3 };

      await ticketController.releaseTicket(req, res);

      expect(TicketService.releaseTicket).toHaveBeenCalledWith('100', { runtimeId: 3 });
      expect(PermissionService.hasPermission).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: 100,
          title: 'Test Ticket',
          status: 'backlog',
          assignedRuntimeId: null,
          lockedAt: null,
        },
      });
    });

    test('should reject a JWT caller without PROJECT_UPDATE', async () => {
      User.find.mockResolvedValueOnce({ role: 'user' });
      PermissionService.hasPermission.mockResolvedValueOnce(false);

      req.params.ticketId = '100';

      await ticketController.releaseTicket(req, res);

      expect(TicketService.releaseTicket).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'PROJECT_UPDATE permission required to release a ticket',
        },
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Ticket not found');
      TicketService.releaseTicket.mockRejectedValueOnce(mockError);

      req.params.ticketId = '100';
      req.agent = { id: 12, owner_id: 1, _node: true };
      req.runtime = { id: 3 };

      const next = jest.fn();
      await ticketController.releaseTicket(req, res, next);

      expect(next).toHaveBeenCalledWith(mockError);
    });
  });

  describe('getMessages', () => {
    test('should return messages for a ticket', async () => {
      const mockMessages = [
        {
          id: 1,
          ticketId: 100,
          userId: 1,
          userName: 'Agent',
          userEmail: 'agent@test.com',
          messageType: 'update',
          content: 'Picked up ticket',
          metadata: {},
          createdAt: new Date(),
        },
      ];

      MessageService.getTicketMessages.mockResolvedValueOnce(mockMessages);

      req.params.ticketId = '100';

      await ticketController.getMessages(req, res, nextFn);

      expect(MessageService.getTicketMessages).toHaveBeenCalledWith('100', 50);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMessages,
      });
    });

    test('should respect limit query parameter', async () => {
      const mockMessages = [];

      MessageService.getTicketMessages.mockResolvedValueOnce(mockMessages);

      req.params.ticketId = '100';
      req.query = { limit: '10' };

      await ticketController.getMessages(req, res);

      expect(MessageService.getTicketMessages).toHaveBeenCalledWith('100', 10);
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Database error');
      MessageService.getTicketMessages.mockRejectedValueOnce(mockError);

      req.params.ticketId = '100';

      await ticketController.getMessages(req, res, nextFn);

      expect(nextFn).toHaveBeenCalledWith(mockError);
    });
  });

  describe('postMessage', () => {
    test('should post a message with required fields', async () => {
      const mockMessage = {
        id: 1,
        ticketId: 100,
        userId: 1,
        userName: 'Agent',
        userEmail: 'agent@test.com',
        messageType: 'update',
        content: 'Agent working on ticket',
        metadata: { agentId: 'agent-1' },
        createdAt: new Date(),
      };

      MessageService.postMessage.mockResolvedValueOnce(mockMessage);

      req.params.ticketId = '100';
      req.body = {
        messageType: 'update',
        content: 'Agent working on ticket',
        metadata: { agentId: 'agent-1' },
      };

      await ticketController.postMessage(req, res);

      expect(MessageService.postMessage).toHaveBeenCalledWith(
        '100',
        1,
        'update',
        'Agent working on ticket',
        { agentId: 'agent-1' }
      );
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: mockMessage,
      });
    });

    test('should return 400 if messageType or content missing', async () => {
      req.params.ticketId = '100';
      req.body = {
        content: 'Only content, no type',
      };

      await ticketController.postMessage(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'messageType and content are required',
        },
      });
    });

    test('should default metadata to empty object if not provided', async () => {
      const mockMessage = {
        id: 1,
        ticketId: 100,
        userId: 1,
        userName: 'Agent',
        userEmail: 'agent@test.com',
        messageType: 'update',
        content: 'Agent working on ticket',
        metadata: {},
        createdAt: new Date(),
      };

      MessageService.postMessage.mockResolvedValueOnce(mockMessage);

      req.params.ticketId = '100';
      req.body = {
        messageType: 'update',
        content: 'Agent working on ticket',
      };

      await ticketController.postMessage(req, res);

      expect(MessageService.postMessage).toHaveBeenCalledWith(
        '100',
        1,
        'update',
        'Agent working on ticket',
        {}
      );
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Database error');
      MessageService.postMessage.mockRejectedValueOnce(mockError);

      req.params.ticketId = '100';
      req.body = {
        messageType: 'update',
        content: 'Agent working on ticket',
      };

      const next = jest.fn();
      await ticketController.postMessage(req, res, next);

      expect(next).toHaveBeenCalledWith(mockError);
    });
  });
  describe('agent workflow mutations', () => {
    test('forces an agent done transition through approval', async () => {
      TicketService.getOne.mockResolvedValue({
        id: 100, status: 'review',
      });
      TicketService.updateStatus.mockResolvedValue(undefined);
      ApprovalService.create.mockResolvedValue({ id: 5, status: 'pending' });

      req.params.ticketId = '100';
      req.agent = { id: 3, owner_id: 7, _node: true };
      req.user = { userId: 7, role: 'project_admin' };
      req.body = { status: 'done' };

      await ticketController.changeStatus(req, res);

      expect(ApprovalService.create).toHaveBeenCalledWith('100', 7);
      expect(TicketService.updateStatus).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          message: 'Approval request submitted. Awaiting review.',
          approval: { id: 5, status: 'pending' },
        },
      });
    });

    test('rejects an agent done transition from a non-review status', async () => {
      TicketService.getOne.mockResolvedValue({
        id: 100, status: 'in_progress',
      });
      TicketService.updateStatus.mockResolvedValue(undefined);

      req.params.ticketId = '100';
      req.agent = { id: 3, owner_id: 7, _node: true };
      req.user = { userId: 7, role: 'project_admin' };
      req.body = { status: 'done' };

      await ticketController.changeStatus(req, res);

      expect(ApprovalService.create).not.toHaveBeenCalled();
      expect(TicketService.updateStatus).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
    });

    test('blocks a direct done status in a generic ticket update', async () => {
      TicketService.getOne.mockResolvedValue({
        id: 100, status: 'review',
      });
      TicketService.update.mockResolvedValue({});
      User.find.mockResolvedValue({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValue(true);

      req.params.ticketId = '100';
      req.agent = { id: 3, owner_id: 7, _node: true };
      req.user = { userId: 7, role: 'project_admin' };
      req.body = { status: 'done', title: 'new title' };

      await ticketController.updateTicket(req, res);

      expect(TicketService.update).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: {
          code: 'INVALID_STATUS',
          message: 'AI agents must submit a review ticket for approval, not mark it done',
        },
      });
    });
  });
});
