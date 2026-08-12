const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/AgentService', () => ({
  getAgentByApiKey: jest.fn().mockResolvedValue(null),
}));

const { pool } = require('../db');

describe('GET /api/v1/tickets/:id/planning — agent auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 with X-API-Key header (regression: was 401 Missing authentication token)', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT t.id, t.project_id')) {
        return Promise.resolve({
          rows: [{ id: 't1', project_id: 1 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/tickets/t1/planning')
      .set('X-API-Key', 'test-agent-key');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 200 with Bearer JWT token', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT t.id, t.project_id')) {
        return Promise.resolve({
          rows: [{ id: 't1', project_id: 1 }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .get('/api/v1/tickets/t1/planning')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 401 without any auth', async () => {
    const res = await request(app)
      .get('/api/v1/tickets/t1/planning');

    expect(res.statusCode).toBe(401);
    expect(res.body.error).toBe('Missing authentication token');
  });
});

describe('POST /api/v1/agents-status/:id/heartbeat — agent auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('should return 200 with valid X-API-Key (regression: was 403 Invalid API key for this agent)', async () => {
    AgentService.getAgentByApiKey.mockResolvedValueOnce({
      id: 'agent-1',
      name: 'Test Agent',
      api_key_expires_at: null,
      role: 'member',
    });

    pool.query.mockImplementation((sql, params) => {
      if (sql.includes('INSERT INTO agent_heartbeats')) {
        return Promise.resolve({
          rows: [{ id: 1, agent_id: params[0], status: 'ok', timestamp: new Date() }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/agents-status/agent-1/heartbeat')
      .set('X-API-Key', 'test-agent-key')
      .send({ status: 'ok' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should return 403 with invalid X-API-Key', async () => {
    AgentService.getAgentByApiKey.mockImplementationOnce(() => Promise.resolve(null));

    const res = await request(app)
      .post('/api/v1/agents-status/agent-1/heartbeat')
      .set('X-API-Key', 'invalid-key')
      .send({ status: 'ok' });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('should return 403 when agent ID does not match URL param (regression: was 403 due to type mismatch)', async () => {
    // Return an agent with a DIFFERENT id than the URL param to exercise the
    // String(agent.id) !== String(req.params.id) comparison on agentHeartbeat.js:49
    AgentService.getAgentByApiKey.mockResolvedValueOnce({
      id: 'agent-999',
      name: 'Other Agent',
      api_key_expires_at: null,
    });

    const res = await request(app)
      .post('/api/v1/agents-status/agent-1/heartbeat')
      .set('X-API-Key', 'test-agent-key')
      .send({ status: 'ok' });

    expect(res.statusCode).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.message).toBe('Invalid API key for this agent');
  });
});
