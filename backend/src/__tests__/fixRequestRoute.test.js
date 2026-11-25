const request = require('supertest');
const app = require('../index');
const FixRequestService = require('../services/FixRequestService');

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
