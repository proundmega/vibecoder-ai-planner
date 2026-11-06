jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
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

describe('TicketService.releaseTicket authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('the assigned agent can release its own ticket', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, assigned_agent_id: '7' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'backlog', assigned_agent_id: null, locked_at: null }],
      });

    const result = await TicketService.releaseTicket(1, { agentId: '7' });

    expect(result.status).toBe('backlog');
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(Project.findById).not.toHaveBeenCalled();
  });

  test('another agent cannot release the ticket', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, assigned_agent_id: '7' }] });

    await expect(
      TicketService.releaseTicket(1, { agentId: '8' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('a project owner can release without an agent identity', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 42 });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, project_id: 1, assigned_agent_id: '7' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'backlog', assigned_agent_id: null, locked_at: null }],
      });

    const result = await TicketService.releaseTicket(1, { operatorId: 42, role: 'member' });

    expect(result.status).toBe('backlog');
    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('a project member can release without an agent identity', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 99 });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, project_id: 1, assigned_agent_id: '7' }] })
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'backlog', assigned_agent_id: null, locked_at: null }],
      });

    const result = await TicketService.releaseTicket(1, { operatorId: 42, role: 'member' });

    expect(result.status).toBe('backlog');
    expect(pool.query).toHaveBeenCalledTimes(3);
  });

  test('a non-member cannot release the ticket', async () => {
    Project.findById.mockResolvedValue({ id: 1, ownerId: 99 });
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, project_id: 1, assigned_agent_id: '7' }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      TicketService.releaseTicket(1, { operatorId: 42, role: 'member' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(pool.query).toHaveBeenCalledTimes(2);
  });

  test('an admin bypasses the project check', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, project_id: 1, assigned_agent_id: '7' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'backlog', assigned_agent_id: null, locked_at: null }],
      });

    const result = await TicketService.releaseTicket(1, { operatorId: 42, role: 'super_admin' });

    expect(result.status).toBe('backlog');
    expect(Project.findById).not.toHaveBeenCalled();
  });
});
