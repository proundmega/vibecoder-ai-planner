const TicketService = require('../services/TicketService');
const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const { ValidationError, NotFoundError, ForbiddenError, ConflictError } = require('../errors/HttpError');

jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');
jest.mock('../services/TicketReadinessService', () => ({
  assertReadyForExecution: jest.fn().mockResolvedValue({ ready: true }),
  emitBlocked: jest.fn().mockResolvedValue(undefined),
  refreshReadyState: jest.fn().mockResolvedValue(undefined),
}));

describe('TicketService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Ticket.findById.mockResolvedValue(null);
    Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
    User.find.mockResolvedValue({ role: 'project_admin' });
    PermissionService.hasPermission.mockResolvedValue(true);
  });

  describe('BP-51-10: Ticket.update() can clear fields to null via dynamic SET', () => {
    test('should update the DB query to use dynamic SET when assigneeId is null', async () => {
      const mockTicket = { id: 't1', status: 'in_progress', priority: 'high', assigneeId: 5, ownerId: 100, projectId: 1 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      // Capture the SQL query and params passed to Ticket.update (model)
      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      // Call service update with assigneeId: null (intending to unassign)
      await TicketService.update('t1', { assigneeId: null }, 100);

      // The service should pass null for assigneeId to the model
      // The model should NOT use COALESCE for null — it should include it in SET
      expect(capturedArgs[1].assigneeId).toBeNull(); // assigneeId should be null, not undefined
    });

    test('should pass undefined for fields not in body (not include in SQL SET)', async () => {
      const mockTicket = { id: 't1', status: 'in_progress', priority: 'high', assigneeId: 5, ownerId: 100, projectId: 1 };
      Ticket.findById.mockResolvedValueOnce(mockTicket);
      User.find.mockResolvedValueOnce({ role: 'project_admin' });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      // Update only status - title, description, priority, assigneeId should all be undefined
      await TicketService.update('t1', { status: 'review' }, 100);

      // Only status should be non-null; title, description, priority, assigneeId should all be undefined
      expect(capturedArgs[1].title).toBeUndefined();   // title
      expect(capturedArgs[1].description).toBeUndefined();   // description
      expect(capturedArgs[1].status).toBe('review');    // status
      expect(capturedArgs[1].priority).toBeUndefined();   // priority
      expect(capturedArgs[1].assigneeId).toBeUndefined();   // assigneeId
    });
  });

  describe('BP-51-06: undefined field handling in update', () => {
    test('should pass undefined for fields not in body (not overwrite existing)', async () => {
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

      // Only update status - title, description, priority, assigneeId should all be undefined
      await TicketService.update('t1', { status: 'in_progress' }, 100);

      expect(capturedArgs[1].title).toBeUndefined();   // title
      expect(capturedArgs[1].description).toBeUndefined();   // description
      expect(capturedArgs[1].status).toBe('in_progress'); // status
      expect(capturedArgs[1].priority).toBeUndefined();   // priority
      expect(capturedArgs[1].assigneeId).toBeUndefined();   // assigneeId
    });

    test('should pass provided values and undefined for fields not in body', async () => {
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

      expect(capturedArgs[1].title).toBe('New Title');  // title
      expect(capturedArgs[1].description).toBeUndefined();     // description (not provided)
      expect(capturedArgs[1].status).toBeUndefined();     // status (not provided)
      expect(capturedArgs[1].priority).toBe('critical');    // priority
      expect(capturedArgs[1].assigneeId).toBeUndefined();     // assigneeId (not provided)
    });

    test('should pass undefined when body contains explicit undefined', async () => {
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

      // Should pass undefined for undefined, so Ticket.update() excludes it from SQL SET
      expect(capturedArgs[1].title).toBeUndefined();
      expect(capturedArgs[1].title).not.toBe(null);
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
        status: 'review',
        priority: 'high',
      }, 100);

      expect(capturedArgs[0]).toBe('t1');
      expect(capturedArgs[1]).toEqual({
        title: 'Updated',
        description: 'New desc',
        status: 'review',
        priority: 'high',
        assigneeId: undefined,
        prUrl: undefined,
      });
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

    test('should reject deleting an in_progress ticket', async () => {
      Ticket.findById.mockResolvedValueOnce({
        id: 't1',
        ownerId: 100,
        projectId: 1,
        status: 'in_progress',
      });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      await expect(TicketService.delete('t1', 100, 'member'))
        .rejects
        .toThrow(ConflictError);

      expect(Ticket.delete).not.toHaveBeenCalled();
    });

    test('should allow deleting a backlog ticket', async () => {
      Ticket.findById.mockResolvedValueOnce({
        id: 't1',
        ownerId: 100,
        projectId: 1,
        status: 'backlog',
      });
      PermissionService.hasPermission.mockResolvedValueOnce(true);

      await TicketService.delete('t1', 100, 'member');

      expect(Ticket.delete).toHaveBeenCalledWith('t1');
    });

    test('should return Forbidden before the in-progress guard for a non-member', async () => {
      Ticket.findById.mockResolvedValueOnce({
        id: 't1',
        ownerId: 100,
        projectId: 1,
        status: 'in_progress',
      });
      PermissionService.hasPermission.mockResolvedValueOnce(true);
      Project.findById.mockResolvedValueOnce({ id: 1, ownerId: 100 });
      // No project membership row for user 200.

      await expect(TicketService.delete('t1', 200, 'member'))
        .rejects
        .toThrow(ForbiddenError);

      expect(Ticket.delete).not.toHaveBeenCalled();
    });
  });

  describe('Agent-initiated operations with userRole', () => {
    const mockTicket = {
      id: 't1',
      title: 'Test ticket',
      description: 'Test',
      status: 'backlog',
      priority: 'medium',
      ownerId: 100,
      projectId: 1,
      assignedAgentId: null,
      phase: 'draft',
    };

    beforeEach(() => {
      jest.clearAllMocks();
      Ticket.findById.mockResolvedValue(mockTicket);
      PermissionService.hasPermission.mockResolvedValue(true);
    });

    test('update should trust userRole from controller, not re-query User', async () => {
      await TicketService.update('t1', { title: 'Updated' }, 100, 'member');
      
      // User.find should NOT be called since userRole is passed
      expect(User.find).not.toHaveBeenCalled();
      expect(PermissionService.hasPermission).toHaveBeenCalledWith('member', 'TICKET_UPDATE');
    });

    test('delete should trust userRole from controller, not re-query User', async () => {
      await TicketService.delete('t1', 100, 'member');
      
      // User.find should NOT be called since userRole is passed
      expect(User.find).not.toHaveBeenCalled();
      expect(PermissionService.hasPermission).toHaveBeenCalledWith('member', 'TICKET_DELETE');
    });

    test('update with agent role should use agent role for permissions', async () => {
      await TicketService.update('t1', { title: 'Updated' }, 100, 'agent');
      
      expect(PermissionService.hasPermission).toHaveBeenCalledWith('agent', 'TICKET_UPDATE');
    });

    test('delete with agent role should use agent role for permissions', async () => {
      await TicketService.delete('t1', 100, 'agent');
      
      expect(PermissionService.hasPermission).toHaveBeenCalledWith('agent', 'TICKET_DELETE');
    });

    test('update without userRole falls back to member', async () => {
      await TicketService.update('t1', { title: 'Updated' }, 100, undefined);
      
      expect(PermissionService.hasPermission).toHaveBeenCalledWith('member', 'TICKET_UPDATE');
    });

    test('delete without userRole falls back to member', async () => {
      await TicketService.delete('t1', 100, undefined);
      
      expect(PermissionService.hasPermission).toHaveBeenCalledWith('member', 'TICKET_DELETE');
    });
  });

  describe('BP-05: prUrl handling in update', () => {
    const mockTicket = {
      id: 't1',
      title: 'Test ticket',
      description: 'Test',
      status: 'in_progress',
      priority: 'medium',
      ownerId: 100,
      projectId: 1,
    };

    beforeEach(() => {
      jest.clearAllMocks();
      Ticket.findById.mockResolvedValue(mockTicket);
      PermissionService.hasPermission.mockResolvedValue(true);
    });

    test('should pass prUrl to Ticket.update()', async () => {
      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      await TicketService.update('t1', { prUrl: 'https://github.com/test/repo/pull/1' }, 100);

      expect(capturedArgs[1].prUrl).toBe('https://github.com/test/repo/pull/1');
    });

    test('should pass undefined for prUrl when not provided', async () => {
      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      await TicketService.update('t1', { status: 'review' }, 100);

      expect(capturedArgs[1].prUrl).toBeUndefined();
    });

    test('should pass null for prUrl when explicitly null', async () => {
      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      await TicketService.update('t1', { prUrl: null }, 100);

      expect(capturedArgs[1].prUrl).toBeNull();
    });

    test('should handle prUrl alongside other fields', async () => {
      let capturedArgs;
      Ticket.update.mockImplementation((...args) => {
        capturedArgs = args;
        return mockTicket;
      });

      await TicketService.update('t1', { status: 'review', prUrl: 'https://github.com/test/repo/pull/5' }, 100);

      expect(capturedArgs[1].status).toBe('review');
      expect(capturedArgs[1].prUrl).toBe('https://github.com/test/repo/pull/5');
    });
  });
});
