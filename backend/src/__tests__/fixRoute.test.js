const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const FixQueueService = require('../services/FixQueueService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
  transaction: jest.fn(),
}));

jest.mock('../services/FixQueueService', () => ({
  listQueue: jest.fn(),
  claim: jest.fn(),
  renew: jest.fn(),
}));

function mockRuntime() {
  jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
    status: 'ok',
    node: { id: 12, owner_id: 7 },
  });
  jest.spyOn(AgentNodeService, 'getRuntimeForNode').mockResolvedValue({
    id: 3,
    role: 'worker',
    status: 'running',
    current_project_id: 5,
  });
  pool.query.mockImplementation((sql) => {
    if (sql.includes('SELECT project_id FROM tickets')) {
      return Promise.resolve({ rows: [{ project_id: 5 }] });
    }
    if (sql.includes('FROM agent_node_grants')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('fix queue/claim/renew routes (fg-32b1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the due queue for the runtime project', async () => {
    mockRuntime();
    FixQueueService.listQueue.mockResolvedValue([
      { id: 'req-1', ticket_id: 42, findings: [] },
    ]);

    const response = await request(app)
      .get('/api/v1/agents/fix-queue?projectId=5&limit=10')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(response.statusCode).toBe(200);
    expect(response.body.data).toEqual([
      { id: 'req-1', ticket_id: 42, findings: [] },
    ]);
    expect(FixQueueService.listQueue).toHaveBeenCalledWith('5', { limit: '10' });
  });

  it('rejects a JWT reading a project fix queue', async () => {
    FixQueueService.listQueue.mockResolvedValue([]);

    const response = await request(app)
      .get('/api/v1/agents/fix-queue?projectId=999')
      .set('Authorization', 'Bearer mock-token');

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('RUNTIME_REQUIRED');
    expect(FixQueueService.listQueue).not.toHaveBeenCalled();
  });

  it('claims a request for the authenticated runtime', async () => {
    mockRuntime();
    FixQueueService.claim.mockResolvedValue({
      request: { id: 'req-1', state: 'claimed' },
      claimed: true,
      reclaimed: false,
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/fix/claim')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ lease_seconds: 120 });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.claimed).toBe(true);
    expect(FixQueueService.claim).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ runtimeId: 3, leaseSeconds: 120 })
    );
  });

  it('renews a lease for the authenticated runtime', async () => {
    mockRuntime();
    FixQueueService.renew.mockResolvedValue({ id: 'req-1', state: 'claimed' });

    const response = await request(app)
      .post('/api/v1/tickets/42/fix/renew')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(response.statusCode).toBe(200);
    expect(response.body.data.request.id).toBe('req-1');
    expect(FixQueueService.renew).toHaveBeenCalledWith(
      '42',
      expect.objectContaining({ runtimeId: 3 })
    );
  });

  it('requires a runtime for claim and renew', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: { id: 12, owner_id: 7 },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/fix/claim')
      .set('X-API-Key', 'at_valid');

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('RUNTIME_REQUIRED');
    expect(FixQueueService.claim).not.toHaveBeenCalled();
  });

  it('requires a runtime for renew', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: { id: 12, owner_id: 7 },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/fix/renew')
      .set('X-API-Key', 'at_valid');

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('RUNTIME_REQUIRED');
    expect(FixQueueService.renew).not.toHaveBeenCalled();
  });

  it('maps a renew conflict to 409', async () => {
    mockRuntime();
    const { ConflictError } = require('../errors/HttpError');
    FixQueueService.renew.mockRejectedValue(
      new ConflictError('Fix lease is not owned by this agent'));

    const response = await request(app)
      .post('/api/v1/tickets/42/fix/renew')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(response.statusCode).toBe(409);
    expect(response.body.success).toBe(false);
  });

  it('maps a live-lease conflict to 409', async () => {
    mockRuntime();
    const { ConflictError } = require('../errors/HttpError');
    FixQueueService.claim.mockRejectedValue(
      new ConflictError('Fix request is claimed by another agent'));

    const response = await request(app)
      .post('/api/v1/tickets/42/fix/claim')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(response.statusCode).toBe(409);
    expect(response.body.success).toBe(false);
  });
});
