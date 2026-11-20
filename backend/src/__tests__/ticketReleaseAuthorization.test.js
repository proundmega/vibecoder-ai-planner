jest.mock('../db', () => ({ pool: { query: jest.fn(), connect: jest.fn() } }));
jest.mock('../models/ticket', () => ({}));
jest.mock('../models/project', () => ({ findById: jest.fn() }));
jest.mock('../models/user', () => ({}));
jest.mock('../services/PermissionService', () => ({}));
jest.mock('../services/TicketPlanningService', () => ({}));
jest.mock('../services/TicketAttachmentService', () => ({}));

const { pool } = require('../db');
const Project = require('../models/project');
const TicketService = require('../services/TicketService');
const { ForbiddenError } = require('../errors/HttpError');

function setup({ ticket = null, updated = [], membership = [] } = {}) {
  const client = {
    query: jest.fn(async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.startsWith('SELECT * FROM tickets')) return { rows: ticket ? [ticket] : [] };
      if (sql.startsWith('UPDATE tickets')) return { rows: updated };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  pool.query.mockResolvedValue({ rows: membership });
  return client;
}

const released = { id: 1, status: 'backlog', assigned_agent_id: null, locked_at: null };

describe('TicketService.releaseTicket authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the assigned agent can release its own ticket', async () => {
    const client = setup({ ticket: { id: 1, assigned_agent_id: '7' }, updated: [released] });

    const result = await TicketService.releaseTicket(1, { agentId: '7' });

    expect(result.status).toBe('backlog');
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('FOR UPDATE'),
      [1]
    );
    expect(client.query).toHaveBeenCalledWith('COMMIT');
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test('another agent cannot release the ticket', async () => {
    const client = setup({ ticket: { id: 1, assigned_agent_id: '7' } });

    await expect(
      TicketService.releaseTicket(1, { agentId: '8' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    expect(client.query.mock.calls.some(([sql]) => sql.startsWith('UPDATE tickets'))).toBe(false);
  });

  test('a project owner can release without an agent identity', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 42 });
    const client = setup({
      ticket: { id: 1, project_id: 1, assigned_agent_id: '7' },
      updated: [released],
    });

    const result = await TicketService.releaseTicket(1, { operatorId: 42, role: 'member' });

    expect(result.status).toBe('backlog');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('a project member can release without an agent identity', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 99 });
    const client = setup({
      ticket: { id: 1, project_id: 1, assigned_agent_id: '7' },
      updated: [released],
      membership: [{ ok: 1 }],
    });

    const result = await TicketService.releaseTicket(1, { operatorId: 42, role: 'member' });

    expect(result.status).toBe('backlog');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('a non-member cannot release the ticket', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 99 });
    const client = setup({
      ticket: { id: 1, project_id: 1, assigned_agent_id: '7' },
      membership: [],
    });

    await expect(
      TicketService.releaseTicket(1, { operatorId: 42, role: 'member' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('an admin bypasses the project check', async () => {
    const client = setup({
      ticket: { id: 1, project_id: 1, assigned_agent_id: '7' },
      updated: [released],
    });

    const result = await TicketService.releaseTicket(1, { operatorId: 42, role: 'super_admin' });

    expect(result.status).toBe('backlog');
    expect(Project.findById).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('a release that loses the assignment race updates nothing', async () => {
    const client = setup({
      ticket: { id: 1, assigned_agent_id: '7' },
      updated: [],
    });

    await expect(
      TicketService.releaseTicket(1, { agentId: '7' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });
});
