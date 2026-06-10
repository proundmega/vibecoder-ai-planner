const ticketController = require('../controllers/ticketController');
const TicketService = require('../services/TicketService');
const MessageService = require('../services/MessageService');

jest.mock('../services/TicketService', () => {
  const actual = jest.requireActual('../services/TicketService');
  return {
    ...actual,
    pickUpTicket: jest.fn(),
    releaseTicket: jest.fn(),
    enforceOwnership: jest.fn(),
    recoverOrphanedTickets: jest.fn(),
    getAgentTickets: jest.fn(),
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
    test('should pick up a ticket and return agent info', async () => {
      const mockTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'in_progress',
        assigned_agent_id: 1,
        locked_at: new Date(),
      };

      TicketService.pickUpTicket.mockResolvedValueOnce(mockTicket);

      req.params.ticketId = '100';

      await ticketController.pickUpTicket(req, res);

      expect(TicketService.pickUpTicket).toHaveBeenCalledWith('100', 1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: 100,
          title: 'Test Ticket',
          status: 'in_progress',
          assignedAgentId: 1,
          lockedAt: expect.any(Date),
        },
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Ticket not found');
      TicketService.pickUpTicket.mockRejectedValueOnce(mockError);

      req.params.ticketId = '100';

      const next = jest.fn();
      await ticketController.pickUpTicket(req, res, next);

      expect(next).toHaveBeenCalledWith(mockError);
    });
  });

  describe('releaseTicket', () => {
    test('should release a ticket and return updated info', async () => {
      const mockTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'backlog',
        assigned_agent_id: null,
        locked_at: null,
      };

      TicketService.releaseTicket.mockResolvedValueOnce(mockTicket);

      req.params.ticketId = '100';

      await ticketController.releaseTicket(req, res);

      expect(TicketService.releaseTicket).toHaveBeenCalledWith('100', 1);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          id: 100,
          title: 'Test Ticket',
          status: 'backlog',
          assignedAgentId: null,
          lockedAt: null,
        },
      });
    });

    test('should pass errors to next middleware', async () => {
      const mockError = new Error('Ticket not found');
      TicketService.releaseTicket.mockRejectedValueOnce(mockError);

      req.params.ticketId = '100';

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
});
