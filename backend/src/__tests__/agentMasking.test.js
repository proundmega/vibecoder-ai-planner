const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((val) => 'decrypted-' + val),
  encrypt: jest.fn(),
  maskToken: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$mockhash123456789012345678901234567890'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: 'user-1', email: 'user@test.com', role: 'member' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

const { pool } = require('../db');

describe('Agent API - Key Masking', () => {
  let listSpy;
  let findByIdSpy;
  const agentRow = {
    id: 'a1',
    name: 'Test Agent',
    api_key_hash: '$2a$10$realhashvalue123456789012345678901234567890',
    api_key_hash_prefix: 'abcdef1234567890',
    owner_id: 'user-1',
    provider_id: 'p1',
    provider_name: 'OpenAI',
    api_key_expires_at: new Date('2026-12-17T00:00:00Z'),
    rate_limit: 100,
    max_actions_per_day: 1000,
    created_at: new Date('2026-11-17T00:00:00Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    listSpy = jest.spyOn(AgentService, 'list').mockResolvedValue([{ ...agentRow }]);
    findByIdSpy = jest.spyOn(AgentService, 'findById').mockResolvedValue({ ...agentRow });
  });

  it('GET /agents masks api_key_hash in response', async () => {
    const res = await request(app)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.agents[0].api_key_hash).toBe('***');
    expect(res.body.agents[0].api_key_hash).not.toBe('$2a$10$realhashvalue123456789012345678901234567890');
  });

  it('GET /agents masks api_key_hash_prefix in response', async () => {
    const res = await request(app)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.agents[0].api_key_hash_prefix).toBe('***');
    expect(res.body.agents[0].api_key_hash_prefix).not.toBe('abcdef1234567890');
  });

  it('GET /agents masked fields are the string "***" not null or empty', async () => {
    const res = await request(app)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.agents[0].api_key_hash).toBe('***');
    expect(res.body.agents[0].api_key_hash_prefix).toBe('***');
    expect(res.body.agents[0].api_key_hash).not.toBe('');
    expect(res.body.agents[0].api_key_hash).not.toBe(null);
  });

  it('GET /agents does not include api_key in response', async () => {
    const res = await request(app)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.agents[0]).not.toHaveProperty('api_key');
  });

  it('GET /agents/:agentId/key returns metadata and never a key preview', async () => {
    const res = await request(app)
      .get('/api/v1/agents/a1/key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.keyStatus).toBe('active');
    expect(res.body).not.toHaveProperty('keyPreview');
    expect(res.body).not.toHaveProperty('api_key');
    expect(res.body.providerName).toBe('OpenAI');
    expect(res.body.rateLimit).toBe(100);
    expect(res.body.maxActionsPerDay).toBe(1000);
    expect(res.body.expiresAt).toBe('2026-12-17T00:00:00.000Z');
  });

  it('GET /agents/:agentId/key reports a revoked key', async () => {
    findByIdSpy.mockResolvedValueOnce({
      ...agentRow,
      api_key_hash: null,
      api_key_hash_prefix: null,
    });

    const res = await request(app)
      .get('/api/v1/agents/a1/key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.keyStatus).toBe('revoked');
    expect(res.body.expiresAt).toBeNull();
  });

  it('GET /agents/:agentId/key reports enrollment credential status', async () => {
    findByIdSpy.mockResolvedValueOnce({
      ...agentRow,
      api_key_hash: null,
      api_key_hash_prefix: null,
      enrolled_at: new Date('2026-11-18T00:00:00Z'),
      project_id: 3,
    });
    jest.spyOn(AgentService, 'getEnrollmentKeyStatus').mockResolvedValueOnce({
      keyStatus: 'active',
      expiresAt: new Date('2026-11-18T01:00:00Z'),
    });

    const res = await request(app)
      .get('/api/v1/agents/a1/key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.authMode).toBe('enrollment');
    expect(res.body.keyStatus).toBe('active');
  });

  it('GET /agents/:agentId/key reports an expired key', async () => {
    findByIdSpy.mockResolvedValueOnce({
      ...agentRow,
      api_key_expires_at: new Date('2020-01-01T00:00:00Z'),
    });

    const res = await request(app)
      .get('/api/v1/agents/a1/key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.keyStatus).toBe('expired');
  });

  it('GET /agents/:agentId/key rejects agent API-key authentication', async () => {
    const res = await request(app)
      .get('/api/v1/agents/a1/key')
      .set('X-API-Key', 'test-agent-key');

    expect(res.statusCode).toBe(401);
  });

  it('POST /agents/create still returns generatedApiKey (plaintext, intentional)', async () => {
    const createMock = {
      id: 'a2',
      name: 'New Agent',
      api_key_expires_at: new Date(),
    };
    pool.query.mockResolvedValueOnce({ rows: [createMock] });

    const res = await request(app)
      .post('/api/v1/agents/create')
      .set('Authorization', 'Bearer mock-token')
      .send({ name: 'New Agent' });

    expect(res.statusCode).toBe(201);
    expect(res.body.generatedApiKey).toMatch(/^ak_/);
  });

  it('GET /agents handles agent with no API key (null hash)', async () => {
    listSpy.mockResolvedValueOnce([
      {
        id: 'a3',
        name: 'Revoked Agent',
        api_key_hash: null,
        api_key_hash_prefix: null,
        api_key: null,
        owner_id: 'user-1',
        rate_limit: 100,
        max_actions_per_day: 1000,
      },
    ]);

    const res = await request(app)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.agents[0].api_key_hash).toBe(null);
    expect(res.body.agents[0].api_key_hash_prefix).toBe(null);
  });
});
