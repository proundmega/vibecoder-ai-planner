const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({
    userId: 'user-1',
    id: 'user-1',
    email: 'user@test.com',
    role: 'project_admin',
  }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('../models/user', () => ({
  find: jest.fn().mockResolvedValue({ id: 'user-1', role: 'project_admin' }),
}));

jest.mock('../services/TicketService', () => ({
  findByProject: jest.fn(),
  findByStatus: jest.fn(),
  findBacklog: jest.fn(),
  getOne: jest.fn(),
  updateStatus: jest.fn(),
}));

const TicketService = require('../services/TicketService');
const { DependencyConflictError } = require('../errors/HttpError');

describe('ticket dependency API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns only the dependency-ready backlog from the agent endpoint', async () => {
    TicketService.findBacklog.mockResolvedValueOnce([
      { id: '10', title: 'Ready', ready: true, blockedBy: [] },
    ]);

    const res = await request(app)
      .get('/api/v1/tickets/project/1/backlog')
      .set('Authorization', 'Bearer token');

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toEqual([
      { id: '10', title: 'Ready', ready: true, blockedBy: [] },
    ]);
    expect(TicketService.findBacklog).toHaveBeenCalledWith('1');
  });

  it('returns 409 DEPENDENCIES_NOT_DONE with blockedBy details', async () => {
    const blockedBy = [
      {
        id: '5',
        title: 'Create the schema',
        status: 'in_progress',
        phase: 'assigned',
        reason: 'not_done',
      },
    ];
    TicketService.getOne.mockResolvedValueOnce({ id: '10', status: 'backlog' });
    TicketService.updateStatus.mockRejectedValueOnce(
      new DependencyConflictError('Cannot start: 1 dependency is not done', {
        ticketId: '10',
        blockedBy,
      })
    );

    const res = await request(app)
      .post('/api/v1/tickets/10/status')
      .set('Authorization', 'Bearer token')
      .send({ status: 'in_progress' });

    expect(res.statusCode).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('DEPENDENCIES_NOT_DONE');
    expect(res.body.error.details).toEqual({ ticketId: '10', blockedBy });
  });
});
