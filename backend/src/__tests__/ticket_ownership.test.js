const { ValidationError, NotFoundError, ForbiddenError } = require('../errors/HttpError');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../models/ticket', () => ({
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  updateStatus: jest.fn(),
  findByProject: jest.fn(),
  findByStatus: jest.fn(),
  getComments: jest.fn(),
  addComment: jest.fn(),
}));

jest.mock('../models/project', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/user', () => ({
  find: jest.fn(),
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn(),
}));

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

describe('TicketService - Agent Orchestration', () => {
  let TicketService;

  beforeEach(() => {
    jest.clearAllMocks();
    TicketService = require('../services/TicketService');
  });

  describe('pickUpTicket', () => {
    test('should pick up a backlog ticket for an agent', async () => {
      const updatedTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'in_progress',
        assigned_agent_id: 1,
        locked_at: new Date(),
      };

      TicketService.pickUpTicket.mockResolvedValueOnce(updatedTicket);

      const result = await TicketService.pickUpTicket(100, 1);

      expect(result).toEqual(updatedTicket);
      expect(result.status).toBe('in_progress');
      expect(result.assigned_agent_id).toBe(1);
    });

    test('should throw error for non-existent ticket', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new NotFoundError('Ticket not found'));

      await expect(TicketService.pickUpTicket(999, 1)).rejects.toThrow(NotFoundError);
    });

    test('should throw error if ticket is not in backlog status', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new ValidationError('Only backlog tickets can be picked up'));

      await expect(TicketService.pickUpTicket(100, 1)).rejects.toThrow(ValidationError);
    });

    test('should throw error if ticket already assigned to another agent', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new ValidationError('Ticket already assigned to another agent'));

      await expect(TicketService.pickUpTicket(100, 1)).rejects.toThrow(ValidationError);
    });

    test('should throw error if ticket was picked up by another agent concurrently', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new ValidationError('Ticket was already picked up by another agent'));

      await expect(TicketService.pickUpTicket(100, 1)).rejects.toThrow(ValidationError);
    });
  });

  describe('releaseTicket', () => {
    test('should release a ticket assigned to an agent', async () => {
      const releasedTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'backlog',
        assigned_agent_id: null,
        locked_at: null,
      };

      TicketService.releaseTicket.mockResolvedValueOnce(releasedTicket);

      const result = await TicketService.releaseTicket(100, 1);

      expect(result.status).toBe('backlog');
      expect(result.assigned_agent_id).toBeNull();
      expect(result.locked_at).toBeNull();
    });

    test('should throw error for non-existent ticket', async () => {
      TicketService.releaseTicket.mockRejectedValueOnce(new NotFoundError('Ticket not found'));

      await expect(TicketService.releaseTicket(999, 1)).rejects.toThrow(NotFoundError);
    });

    test('should throw error if ticket is not assigned to any agent', async () => {
      TicketService.releaseTicket.mockRejectedValueOnce(new ValidationError('Ticket is not assigned to any agent'));

      await expect(TicketService.releaseTicket(100, 1)).rejects.toThrow(ValidationError);
    });
  });

  describe('enforceOwnership', () => {
    test('should return ticket when agent owns it', async () => {
      const mockTicket = {
        id: 100,
        assigned_agent_id: 1,
      };

      TicketService.enforceOwnership.mockResolvedValueOnce(mockTicket);

      const result = await TicketService.enforceOwnership(100, 1);

      expect(result).toEqual(mockTicket);
    });

    test('should return ticket when no agent is assigned', async () => {
      const mockTicket = {
        id: 100,
        assigned_agent_id: null,
      };

      TicketService.enforceOwnership.mockResolvedValueOnce(mockTicket);

      const result = await TicketService.enforceOwnership(100, 5);

      expect(result).toEqual(mockTicket);
    });

    test('should throw ForbiddenError when another agent owns the ticket', async () => {
      TicketService.enforceOwnership.mockRejectedValueOnce(new ForbiddenError('Ticket is being worked on by agent 2'));

      await expect(TicketService.enforceOwnership(100, 1)).rejects.toThrow(ForbiddenError);
    });

    test('should throw NotFoundError for non-existent ticket', async () => {
      TicketService.enforceOwnership.mockRejectedValueOnce(new NotFoundError('Ticket not found'));

      await expect(TicketService.enforceOwnership(999, 1)).rejects.toThrow(NotFoundError);
    });
  });

  describe('recoverOrphanedTickets', () => {
    test('should recover tickets locked longer than staleMinutes', async () => {
      const staleTicket = {
        id: 100,
        title: 'Stale Ticket',
        assigned_agent_id: 1,
        locked_at: new Date(Date.now() - 120 * 60 * 1000), // 2 hours ago
      };

      TicketService.recoverOrphanedTickets.mockResolvedValueOnce([staleTicket]);

      const result = await TicketService.recoverOrphanedTickets(60);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(100);
    });

    test('should not recover recent locks', async () => {
      TicketService.recoverOrphanedTickets.mockResolvedValueOnce([]);

      const result = await TicketService.recoverOrphanedTickets(60);

      expect(result).toHaveLength(0);
    });

    test('should call with correct parameters', async () => {
      TicketService.recoverOrphanedTickets.mockResolvedValueOnce([]);

      await TicketService.recoverOrphanedTickets(60);

      expect(TicketService.recoverOrphanedTickets).toHaveBeenCalledWith(60);
    });
  });
});
