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

  beforeEach(() => {
    jest.clearAllMocks();
    listSpy = jest.spyOn(AgentService, 'list').mockResolvedValue([
      {
        id: 'a1',
        name: 'Test Agent',
        api_key_hash: '$2a$10$realhashvalue123456789012345678901234567890',
        api_key_hash_prefix: 'abcdef1234567890',
        api_key: 'ak_test123456789',
        owner_id: 'user-1',
        rate_limit: 100,
        max_actions_per_day: 1000,
      },
    ]);
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

  it('GET /agents does not mask api_key (plaintext key for display)', async () => {
    const res = await request(app)
      .get('/api/v1/agents')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.agents[0].api_key).toBe('ak_test123456789');
  });

  it('GET /agents/:agentId/key returns key preview', async () => {
    const res = await request(app)
      .get('/api/v1/agents/a1/key')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.keyPreview).toBe('ak_test1***');
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
