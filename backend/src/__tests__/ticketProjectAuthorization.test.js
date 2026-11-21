jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));
jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');
jest.mock('../services/DependencyService', () => ({
  enrich: jest.fn(async tickets => tickets),
  assertReady: jest.fn().mockResolvedValue({ ready: true }),
}));

const { pool } = require('../db');
const Ticket = require('../models/ticket');
const Project = require('../models/project');
const PermissionService = require('../services/PermissionService');
const TicketService = require('../services/TicketService');
const { ForbiddenError } = require('../errors/HttpError');

describe('TicketService project-membership authorization (bp-133 FR4)', () => {
  const ticket = { id: '1', ownerId: '100', projectId: '10' };

  beforeEach(() => {
    jest.clearAllMocks();
    Ticket.findById.mockResolvedValue(ticket);
    Ticket.update.mockResolvedValue(ticket);
    Ticket.delete.mockResolvedValue(undefined);
    Project.findById.mockResolvedValue({ id: '10', ownerId: '900' });
    PermissionService.hasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('update', () => {
    test('allows the ticket owner', async () => {
      await TicketService.update('1', { title: 'x' }, '100', 'user');

      expect(Ticket.update).toHaveBeenCalled();
    });

    test('allows the project owner', async () => {
      await TicketService.update('1', { title: 'x' }, '900', 'member');

      expect(Ticket.update).toHaveBeenCalled();
    });

    test('allows an active project member', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });

      await TicketService.update('1', { title: 'x' }, '300', 'member');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('project_memberships'),
        ['10', '300']
      );
      expect(Ticket.update).toHaveBeenCalled();
    });

    test('rejects a non-member', async () => {
      await expect(
        TicketService.update('1', { title: 'x' }, '400', 'member')
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(Ticket.update).not.toHaveBeenCalled();
    });

    test('keeps the project_admin / super_admin bypass', async () => {
      await TicketService.update('1', { title: 'x' }, '400', 'project_admin');
      await TicketService.update('1', { title: 'x' }, '400', 'super_admin');

      expect(Project.findById).not.toHaveBeenCalled();
      expect(Ticket.update).toHaveBeenCalledTimes(2);
    });
  });

  describe('delete', () => {
    test('allows a project member and rejects a non-member', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ok: 1 }] });
      await TicketService.delete('1', '300', 'member');

      await expect(
        TicketService.delete('1', '400', 'member')
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(Ticket.delete).toHaveBeenCalledTimes(1);
    });

    test('keeps the admin bypass', async () => {
      await TicketService.delete('1', '400', 'super_admin');

      expect(Ticket.delete).toHaveBeenCalled();
    });
  });

  describe('pickup', () => {
    const backlogTicket = {
      id: '1',
      project_id: '10',
      status: 'backlog',
      assigned_runtime_id: null,
    };
    const pickedUp = { ...backlogTicket, status: 'in_progress', assigned_runtime_id: '7' };

    function connectWith(rows) {
      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [backlogTicket] }) // SELECT ... FOR UPDATE
        .mockResolvedValueOnce({ rows }) // UPDATE
        .mockResolvedValueOnce({}); // COMMIT
      pool.connect.mockResolvedValueOnce(client);
      return client;
    }

    test('allows a runtime whose owner is a project member', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [backlogTicket] })
        .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
      connectWith([pickedUp]);

      const result = await TicketService.pickUpTicket('1', {
        runtimeId: '7',
        operatorId: '300',
        role: 'member',
      });

      expect(result.assigned_runtime_id).toBe('7');
    });

    test('allows a runtime owned by the project owner', async () => {
      pool.query.mockResolvedValueOnce({ rows: [backlogTicket] });
      connectWith([pickedUp]);

      const result = await TicketService.pickUpTicket('1', {
        runtimeId: '7',
        operatorId: '900',
        role: 'member',
      });

      expect(result.assigned_runtime_id).toBe('7');
    });

    test('resolves the owner and role from the runtime when only runtimeId is given', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ owner_id: '300', role: 'member' }] })
        .mockResolvedValueOnce({ rows: [backlogTicket] })
        .mockResolvedValueOnce({ rows: [{ ok: 1 }] });
      connectWith([pickedUp]);

      const result = await TicketService.pickUpTicket('1', { runtimeId: '7' });

      expect(pool.query.mock.calls[0][0]).toContain('agent_runtimes');
      expect(result.assigned_runtime_id).toBe('7');
    });

    test('rejects a runtime whose owner is not a member', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [backlogTicket] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        TicketService.pickUpTicket('1', {
          runtimeId: '7',
          operatorId: '400',
          role: 'member',
        })
      ).rejects.toBeInstanceOf(ForbiddenError);
    });

    test('requires a runtime id', async () => {
      await expect(
        TicketService.pickUpTicket('1', { operatorId: '300', role: 'member' })
      ).rejects.toThrow(/runtimeId is required/);
    });
  });

});
