const request = require('supertest');
const app = require('../index');
const UsageLogger = require('../services/UsageLogger');
const AgentService = require('../services/AgentService');

jest.mock('../services/UsageLogger');
jest.mock('../services/AgentService');
jest.mock('../controllers/usageController', () => ({
  getProjectUsage: jest.fn(),
  getUserUsage: jest.fn(),
  getModelPricing: jest.fn(),
}));

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  pool.query.mockImplementation((sql) => {
    if (sql.includes('INSERT INTO provider_configs')) {
      return Promise.resolve({
        rows: [{
          id: 'pc-1',
          project_id: 1,
          provider: 'openai',
          endpoint_url: null,
          model: 'gpt-4',
          api_key_encrypted: null,
          fallback_provider: null,
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });
    }
    if (sql.includes('SELECT * FROM provider_configs')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { pool };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

describe('Usage API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    UsageLogger.reportUsage.mockResolvedValue(undefined);
  });

  describe('POST /api/v1/usage/agents/:agentId/usage', () => {
    it('should store usage and return 200 with valid agent key', async () => {
      const res = await request(app)
        .post('/api/v1/usage/agents/mock-agent-1/usage')
        .set('X-API-Key', 'test-agent-key')
        .send({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          tokens_out: 800,
          duration_ms: 3500,
          ticket_id: 42,
          project_id: 1,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recorded).toBe(true);
      expect(UsageLogger.reportUsage).toHaveBeenCalledWith(
        'mock-agent-1',
        expect.objectContaining({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          tokens_out: 800,
        })
      );
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/v1/usage/agents/mock-agent-1/usage')
        .set('X-API-Key', 'test-agent-key')
        .send({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          // tokens_in and tokens_out missing
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toBe('Missing required fields: provider_type, model, tokens_in, tokens_out');
      expect(UsageLogger.reportUsage).not.toHaveBeenCalled();
    });

    it('should return 401 without API key', async () => {
      const res = await request(app)
        .post('/api/v1/usage/agents/mock-agent-1/usage')
        .send({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          tokens_out: 800,
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Missing API key');
      expect(UsageLogger.reportUsage).not.toHaveBeenCalled();
    });

    it('should return 401 with invalid API key', async () => {
      AgentService.getAgentByApiKey.mockResolvedValueOnce(null);

      const res = await request(app)
        .post('/api/v1/usage/agents/mock-agent-1/usage')
        .set('X-API-Key', 'invalid-key')
        .send({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          tokens_out: 800,
        });

      expect(res.statusCode).toBe(401);
      expect(res.body.error).toBe('Invalid API key');
      expect(UsageLogger.reportUsage).not.toHaveBeenCalled();
    });

    it('should return 403 when agent ID does not match authenticated agent', async () => {
      // test- prefixed keys resolve to 'mock-agent-1'
      const res = await request(app)
        .post('/api/v1/usage/agents/999/usage')
        .set('X-API-Key', 'test-agent-key')
        .send({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          tokens_out: 800,
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(res.body.error.message).toBe('Agents can only report usage for their own agent ID');
      expect(UsageLogger.reportUsage).not.toHaveBeenCalled();
    });

    it('should return 403 when real agent tries to report for a different agent', async () => {
      AgentService.getAgentByApiKey.mockResolvedValueOnce({
        id: 'agent-real-1',
        name: 'Real Agent',
        api_key_expires_at: null,
      });

      const res = await request(app)
        .post('/api/v1/usage/agents/agent-real-999/usage')
        .set('X-API-Key', 'real-agent-key')
        .send({
          provider_type: 'openai',
          model: 'gpt-4o',
          tokens_in: 1000,
          tokens_out: 500,
        });

      expect(res.statusCode).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('FORBIDDEN');
      expect(UsageLogger.reportUsage).not.toHaveBeenCalled();
    });

    it('should accept mock-agent-key', async () => {
      const res = await request(app)
        .post('/api/v1/usage/agents/mock-agent-1/usage')
        .set('X-API-Key', 'mock-agent-key')
        .send({
          provider_type: 'openai',
          model: 'gpt-4o',
          tokens_in: 500,
          tokens_out: 200,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(UsageLogger.reportUsage).toHaveBeenCalled();
    });
  });

});
