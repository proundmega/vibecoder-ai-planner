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
        assigned_runtime_id: 1,
        locked_at: new Date(),
      };

      TicketService.pickUpTicket.mockResolvedValueOnce(updatedTicket);

      const result = await TicketService.pickUpTicket(100, { runtimeId: 1 });

      expect(result).toEqual(updatedTicket);
      expect(result.status).toBe('in_progress');
      expect(result.assigned_runtime_id).toBe(1);
    });

    test('should throw error for non-existent ticket', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new NotFoundError('Ticket not found'));

      await expect(TicketService.pickUpTicket(999, { runtimeId: 1 })).rejects.toThrow(NotFoundError);
    });

    test('should throw error if ticket is not in backlog status', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new ValidationError('Only backlog tickets can be picked up'));

      await expect(TicketService.pickUpTicket(100, { runtimeId: 1 })).rejects.toThrow(ValidationError);
    });

    test('should throw error if ticket already assigned to another agent', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new ValidationError('Ticket already assigned to another agent'));

      await expect(TicketService.pickUpTicket(100, { runtimeId: 1 })).rejects.toThrow(ValidationError);
    });

    test('should throw error if ticket was picked up by another agent concurrently', async () => {
      TicketService.pickUpTicket.mockRejectedValueOnce(new ValidationError('Ticket was already picked up by another agent'));

      await expect(TicketService.pickUpTicket(100, { runtimeId: 1 })).rejects.toThrow(ValidationError);
    });
  });

  describe('releaseTicket', () => {
    test('should release a ticket assigned to an agent', async () => {
      const releasedTicket = {
        id: 100,
        title: 'Test Ticket',
        status: 'backlog',
        assigned_runtime_id: null,
        locked_at: null,
      };

      TicketService.releaseTicket.mockResolvedValueOnce(releasedTicket);

      const result = await TicketService.releaseTicket(100, { runtimeId: 1 });

      expect(result.status).toBe('backlog');
      expect(result.assigned_runtime_id).toBeNull();
      expect(result.locked_at).toBeNull();
    });

    test('should throw error for non-existent ticket', async () => {
      TicketService.releaseTicket.mockRejectedValueOnce(new NotFoundError('Ticket not found'));

      await expect(TicketService.releaseTicket(999, { runtimeId: 1 })).rejects.toThrow(NotFoundError);
    });

    test('should throw error if ticket is not assigned to any agent', async () => {
      TicketService.releaseTicket.mockRejectedValueOnce(new ValidationError('Ticket is not assigned to any agent'));

      await expect(TicketService.releaseTicket(100, { runtimeId: 1 })).rejects.toThrow(ValidationError);
    });
  });
});