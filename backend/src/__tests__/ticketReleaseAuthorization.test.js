jest.mock('../db', () => ({ pool: { query: jest.fn() } }));
jest.mock('../models/ticket', () => ({}));
jest.mock('../models/project', () => ({}));
jest.mock('../models/user', () => ({}));
jest.mock('../services/PermissionService', () => ({}));
jest.mock('../services/TicketPlanningService', () => ({}));
jest.mock('../services/TicketAttachmentService', () => ({}));

const { pool } = require('../db');
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
  });

  test('another agent cannot release the ticket', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, assigned_agent_id: '7' }] });

    await expect(
      TicketService.releaseTicket(1, { agentId: '8' })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  test('an operator can release without an agent identity', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 1, assigned_agent_id: '7' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 1, status: 'backlog', assigned_agent_id: null, locked_at: null }],
      });

    const result = await TicketService.releaseTicket(1, { operatorId: 42 });

    expect(result.status).toBe('backlog');
  });
});
