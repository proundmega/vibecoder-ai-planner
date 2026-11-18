const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');
const AgentEnrollmentService = require('../services/AgentEnrollmentService');
const HeartbeatService = require('../services/HeartbeatService');
const PermissionService = require('../services/PermissionService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/HeartbeatService', () => ({
  recordHeartbeat: jest.fn().mockResolvedValue(undefined),
}));

describe('Agent token authentication (FR4, FR6, FR9, FR10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService.hasAnyPermission.mockResolvedValue(true);
    jest.spyOn(HeartbeatService, 'recordHeartbeat').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('accepts an enrollment access token on the heartbeat route', async () => {
    jest.spyOn(AgentEnrollmentService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      agent: { id: 42, owner_id: 7, name: 'worker' },
    });

    const res = await request(app)
      .post('/api/v1/agents-status/42/heartbeat')
      .set('X-API-Key', 'at_valid')
      .send({ current_step: 'working' });

    expect(res.statusCode).toBe(200);
    expect(HeartbeatService.recordHeartbeat).toHaveBeenCalledWith(42, expect.objectContaining({ step: 'working' }));
  });

  it('rejects an expired access token with TOKEN_EXPIRED', async () => {
    jest.spyOn(AgentEnrollmentService, 'authenticateAccessToken').mockResolvedValue({
      status: 'expired',
      agent: null,
    });

    const res = await request(app)
      .post('/api/v1/agents-status/42/heartbeat')
      .set('X-API-Key', 'at_expired')
      .send({});

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
    expect(HeartbeatService.recordHeartbeat).not.toHaveBeenCalled();
  });

  it('rejects a revoked access token with TOKEN_REVOKED', async () => {
    jest.spyOn(AgentEnrollmentService, 'authenticateAccessToken').mockResolvedValue({
      status: 'revoked',
      agent: null,
    });

    const res = await request(app)
      .post('/api/v1/agents-status/42/heartbeat')
      .set('X-API-Key', 'at_revoked')
      .send({});

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_REVOKED');
  });

  it('keeps legacy ak_ keys working', async () => {
    jest.spyOn(AgentService, 'getAgentByApiKey').mockResolvedValue({
      id: 42,
      owner_id: 7,
      name: 'legacy',
      api_key_expires_at: new Date(Date.now() + 60_000),
    });

    const res = await request(app)
      .post('/api/v1/agents-status/42/heartbeat')
      .set('X-API-Key', 'ak_legacy')
      .send({});

    expect(res.statusCode).toBe(200);
    expect(HeartbeatService.recordHeartbeat).toHaveBeenCalled();
  });

  it('rejects an expired legacy key on heartbeat', async () => {
    jest.spyOn(AgentService, 'getAgentByApiKey').mockResolvedValue({
      id: 42,
      owner_id: 7,
      name: 'legacy',
      api_key_expires_at: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .post('/api/v1/agents-status/42/heartbeat')
      .set('X-API-Key', 'ak_expired')
      .send({});

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('KEY_EXPIRED');
    expect(HeartbeatService.recordHeartbeat).not.toHaveBeenCalled();
  });

  it('does not let an agent heartbeat for a different agent id', async () => {
    jest.spyOn(AgentEnrollmentService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      agent: { id: 42, owner_id: 7, name: 'worker' },
    });

    const res = await request(app)
      .post('/api/v1/agents-status/99/heartbeat')
      .set('X-API-Key', 'at_valid')
      .send({});

    expect(res.statusCode).toBe(403);
    expect(HeartbeatService.recordHeartbeat).not.toHaveBeenCalled();
  });

  it('rejects an expired legacy key on provider-config before decrypting', async () => {
    jest.spyOn(AgentService, 'getAgentByApiKey').mockResolvedValue({
      id: 42,
      owner_id: 7,
      name: 'legacy',
      provider_id: 2,
      api_key_expires_at: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get('/api/v1/agents/42/provider-config')
      .set('X-API-Key', 'ak_expired');

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects an expired legacy key on the agent history route', async () => {
    jest.spyOn(AgentService, 'getAgentByApiKey').mockResolvedValue({
      id: 42,
      owner_id: 7,
      name: 'legacy',
      api_key_expires_at: new Date(Date.now() - 1000),
    });

    const res = await request(app)
      .get('/api/v1/agents/42/history')
      .set('X-API-Key', 'ak_expired');

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('KEY_EXPIRED');
  });

  it('revokes access and refresh tokens when a legacy key is revoked', async () => {
    const spy = jest.spyOn(AgentEnrollmentService, 'revokeAllForAgent').mockResolvedValue(undefined);
    await AgentService.revokeApiKey(42);
    expect(spy).toHaveBeenCalledWith(42);
  });
});
