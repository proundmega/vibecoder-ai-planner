const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const FixRequestService = require('../services/FixRequestService');
const Ticket = require('../models/ticket');
const TicketService = require('../services/TicketService');
const PermissionService = require('../services/PermissionService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
  transaction: jest.fn(),
}));

jest.mock('../services/FixRequestService', () => ({
  createOrEnsure: jest.fn(),
}));

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';

describe('POST /tickets/:id/review/request-changes (fg-32a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ userId: 7, role: 'member' });
    jest.spyOn(PermissionService, 'hasAnyPermission').mockResolvedValue(true);
    jest.spyOn(Ticket, 'findById').mockResolvedValue({
      id: 42,
      projectId: 5,
      ownerId: 1,
    });
    jest.spyOn(TicketService, 'canActOnTicketProject').mockResolvedValue(true);
  });

  it('creates a request for a reviewer agent', async () => {
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: true,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'test-reviewer')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: { id: 'req-1', state: 'queued' },
    });
    expect(FixRequestService.createOrEnsure).toHaveBeenCalledWith(
      '42',
      { attemptId: ATTEMPT_ID, feedback: null },
      { actorId: expect.anything() }
    );
  });

  it('rejects a human who is not a member of the ticket project', async () => {
    TicketService.canActOnTicketProject.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(403);
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('allows a member JWT and passes the numeric user id as the actor', async () => {
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: true,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(201);
    expect(FixRequestService.createOrEnsure).toHaveBeenCalledWith(
      '42',
      { attemptId: null, feedback: 'Please fix this' },
      { actorId: 7 }
    );
  });

  it('rejects manual feedback from an agent', async () => {
    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'test-reviewer')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(400);
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('returns the existing request with 200', async () => {
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: false,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'test-reviewer')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.id).toBe('req-1');
  });

  it('maps a service conflict to 409', async () => {
    const { ConflictError } = require('../errors/HttpError');
    FixRequestService.createOrEnsure.mockRejectedValue(
      new ConflictError('Review attempt did not request changes'));

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'test-reviewer')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(409);
    expect(response.body.success).toBe(false);
  });
});
