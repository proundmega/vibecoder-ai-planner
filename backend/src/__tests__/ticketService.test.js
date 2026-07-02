const TicketService = require('../services/TicketService');
const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const { ValidationError, NotFoundError, ForbiddenError } = require('../errors/HttpError');

jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');

describe('TicketService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Ticket.findById.mockResolvedValue(null);
    Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
    User.find.mockResolvedValue({ role: 'project_admin' });
    PermissionService.hasPermission.mockResolvedValue(true);
  });

  describe('BP-51-02: staleMinutes validation in recoverOrphanedTickets', () => {
    test('should throw ValidationError for non-numeric staleMinutes', async () => {
      await expect(TicketService.recoverOrphanedTickets('60'))
        .rejects
        .toThrow(ValidationError);
    });

    test('should throw ValidationError for string staleMinutes', async () => {
      await expect(TicketService.recoverOrphanedTickets('not-a-number'))
        .rejects
        .toThrow(ValidationError);
    });

    test('should throw ValidationError for negative staleMinutes', async () => {
      await expect(TicketService.recoverOrphanedTickets(-10))
        .rejects
        .toThrow(ValidationError);
    });

    test('should throw ValidationError for zero staleMinutes', async () => {
      await expect(TicketService.recoverOrphanedTickets(0))
        .rejects
        .toThrow(ValidationError);
    });

    test('should throw ValidationError for null staleMinutes', async () => {
      await expect(TicketService.recoverOrphanedTickets(null))
        .rejects
        .toThrow(ValidationError);
    });

    test('should use default 60 when called without arguments', async () => {
      const mockRows = [];
      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await TicketService.recoverOrphanedTickets();
      expect(result).toEqual([]);
    });

    test('should throw ValidationError for boolean staleMinutes', async () => {
      await expect(TicketService.recoverOrphanedTickets(true))
        .rejects
        .toThrow(ValidationError);
    });

    test('should accept valid numeric staleMinutes', async () => {
      const mockRows = [{ id: 't1', title: 'Test', assigned_agent_id: 'a1', locked_at: new Date() }];
      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await TicketService.recoverOrphanedTickets(60);
      expect(result).toEqual(mockRows);
    });

    test('should accept default staleMinutes of 60', async () => {
      const mockRows = [];
      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await TicketService.recoverOrphanedTickets();
      expect(result).toEqual([]);
    });

    test('should throw correct error message', async () => {
      try {
        await TicketService.recoverOrphanedTickets(-1);
      } catch (err) {
        expect(err.message).toBe('staleMinutes must be a positive number');
      }
    });

    test('should use parameterized make_interval() instead of string interpolation (BP-51-02 regression)', async () => {
      const mockRows = [];
      require('../db').pool.query.mockResolvedValueOnce({ rows: mockRows });

      await TicketService.recoverOrphanedTickets(60);

      const queryCall = require('../db').pool.query.mock.calls[0];
      const sql = queryCall[0];
      const values = queryCall[1];

      // Should use make_interval with parameter, not string interpolation
      expect(sql).toContain('make_interval(mins => $1)');
      expect(sql).not.toContain("INTERVAL '");
      expect(sql).not.toContain('${');

      // staleMinutes should be passed as a parameter value
      expect(values).toEqual([60]);
    });
  });

  describe('BP-51-06: undefined field handling in update', () => {
    test('should pass null for undefined title (not overwrite existing)', async () => {
      const mockTicket = { id: 't1', status: 'in_progress', priority: 'high', assigneeId: 5, ownerId: 100, projectId: 1 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      // Simulate Ticket.update to capture what it receives
      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      // Only update status - title, description, priority, assigneeId should all be null
      await TicketService.update('t1', { status: 'in_progress' }, 100);

      expect(capturedArgs[1]).toBeNull();   // title
      expect(capturedArgs[2]).toBeNull();   // description
      expect(capturedArgs[3]).toBe('in_progress'); // status
      expect(capturedArgs[4]).toBeNull();   // priority
      expect(capturedArgs[5]).toBeNull();   // assigneeId
      expect(capturedArgs[6]).toBe(100);    // userId
    });

    test('should pass provided values and null for undefined fields', async () => {
      const mockTicket = { id: 't1', status: 'backlog', priority: 'medium', assigneeId: null, ownerId: 100, projectId: 1 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      // Update only title and priority
      await TicketService.update('t1', { title: 'New Title', priority: 'critical' }, 100);

      expect(capturedArgs[1]).toBe('New Title');  // title
      expect(capturedArgs[2]).toBeNull();          // description (not provided)
      expect(capturedArgs[3]).toBeNull();          // status (not provided)
      expect(capturedArgs[4]).toBe('critical');    // priority
      expect(capturedArgs[5]).toBeNull();          // assigneeId (not provided)
      expect(capturedArgs[6]).toBe(100);           // userId
    });

    test('should not pass undefined values to Ticket.update', async () => {
      const mockTicket = { id: 't1', status: 'backlog', priority: 'medium', assigneeId: null, ownerId: 100, projectId: 1 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      await TicketService.update('t1', { title: undefined }, 100);

      // Should pass null for undefined, not undefined itself
      expect(capturedArgs[1]).toBeNull();
      expect(capturedArgs[1]).not.toBe(undefined);
    });

    test('should pass all defined fields correctly', async () => {
      const mockTicket = { id: 't1', status: 'backlog', priority: 'medium', assigneeId: null, ownerId: 100, projectId: 1 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      // Don't include assigneeId to avoid project member validation
      await TicketService.update('t1', {
        title: 'Updated',
        description: 'New desc',
        status: 'in_progress',
        priority: 'high',
      }, 100);

      expect(capturedArgs).toEqual(['t1', 'Updated', 'New desc', 'in_progress', 'high', null, 100]);
    });
  });

  describe('getOne', () => {
    test('should return ticket with planning and attachments', async () => {
      const mockTicket = { id: 't1', title: 'Test' };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      require('../services/TicketPlanningService').getPlanningForTicket.mockResolvedValue({ phase: 'draft' });
      require('../services/TicketAttachmentService').list.mockResolvedValue([]);

      const result = await TicketService.getOne('t1', 100);
      expect(result.title).toBe('Test');
      expect(result.planning).toEqual({ phase: 'draft' });
      expect(result.attachments).toEqual([]);
    });
  });

  describe('delete', () => {
    test('should throw NotFoundError when ticket not found', async () => {
      Ticket.findById.mockResolvedValueOnce(null);

      await expect(TicketService.delete('t1', 100))
        .rejects
        .toThrow(NotFoundError);
    });

    test('should throw ForbiddenError when user lacks permission', async () => {
      const mockTicket = { id: 't1', ownerId: 200 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'user' });
      PermissionService.hasPermission.mockResolvedValueOnce(false);

      await expect(TicketService.delete('t1', 100))
        .rejects
        .toThrow(ForbiddenError);
    });
  });
});
