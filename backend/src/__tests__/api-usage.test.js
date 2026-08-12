const request = require('supertest');
const app = require('../index');
const UsageLogger = require('../services/UsageLogger');
const AgentService = require('../services/AgentService');
const PermissionService = require('../services/PermissionService');

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
  return { pool };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
}));

describe('Usage API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    UsageLogger.reportUsage.mockResolvedValue(undefined);
  });

  describe('POST /api/v1/usage/agents/:agentId/usage', () => {
    it('should store usage and return 200 with valid agent key', async () => {
      const res = await request(app)
        .post('/api/v1/usage/agents/1/usage')
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
        '1',
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
        .post('/api/v1/usage/agents/1/usage')
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
        .post('/api/v1/usage/agents/1/usage')
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
      // test- prefixed keys resolve to id 1
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
        .post('/api/v1/usage/agents/1/usage')
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

    it('should accept planning_stage and file_keys in request body', async () => {
      const res = await request(app)
        .post('/api/v1/usage/agents/1/usage')
        .set('X-API-Key', 'test-agent-key')
        .send({
          provider_type: 'claude',
          model: 'claude-sonnet-4-20250514',
          tokens_in: 2000,
          tokens_out: 800,
          duration_ms: 3500,
          ticket_id: 42,
          planning_stage: 'plan_generation',
          file_keys: ['01_ARCHITECT_REQUIREMENT.md', '02_ARCHITECT_DESIGN.md'],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(UsageLogger.reportUsage).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          planning_stage: 'plan_generation',
          file_keys: ['01_ARCHITECT_REQUIREMENT.md', '02_ARCHITECT_DESIGN.md'],
        })
      );
    });
  });

  describe('GET /api/v1/tickets/:ticketId/planning/usage', () => {

    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .get('/api/v1/tickets/42/planning/usage');

      expect(res.statusCode).toBe(401);
    });

    it('should return 404 for invalid ticket ID (NaN query returns no rows)', async () => {
      const res = await request(app)
        .get('/api/v1/tickets/abc/planning/usage')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(404);
    });

    it('should return 404 for non-existent ticket', async () => {
      jest.mocked(require('../db').pool.query).mockImplementation((sql) => {
        if (sql.includes('SELECT t.id, t.project_id')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .get('/api/v1/tickets/999/planning/usage')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });


  });

  describe('GET /api/v1/tickets/:ticketId/planning/:fileKey/usage', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .get('/api/v1/tickets/42/planning/01_ARCHITECT_REQUIREMENT.md/usage');

      expect(res.statusCode).toBe(401);
    });

    it('should return last usage and history for a file', async () => {
      jest.mocked(require('../db').pool.query).mockImplementation((sql) => {
        if (sql.includes('last_tokens_in')) {
          return Promise.resolve({
            rows: [{
              last_tokens_in: 5000,
              last_tokens_out: 800,
              last_cost_usd: '0.015000',
              last_duration_ms: 8000,
              last_provider_type: 'claude',
              last_model: 'claude-sonnet-4-20250514',
              last_planning_stage: 'requirement_extraction',
              last_ai_call_at: '2026-07-23T10:30:00.000Z',
            }],
          });
        }
        if (sql.includes('created_at as at')) {
          return Promise.resolve({
            rows: [
              {
                tokens_in: 5000,
                tokens_out: 800,
                cost_usd: '0.015000',
                duration_ms: 8000,
                provider_type: 'claude',
                model: 'claude-sonnet-4-20250514',
                planning_stage: 'requirement_extraction',
                at: '2026-07-23T10:30:00.000Z',
              },
              {
                tokens_in: 4000,
                tokens_out: 600,
                cost_usd: '0.012000',
                duration_ms: 7000,
                provider_type: 'claude',
                model: 'claude-sonnet-4-20250514',
                planning_stage: 'requirement_extraction',
                at: '2026-07-22T14:00:00.000Z',
              },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .get('/api/v1/tickets/42/planning/01_ARCHITECT_REQUIREMENT.md/usage')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.fileKey).toBe('01_ARCHITECT_REQUIREMENT.md');
      expect(res.body.data.lastUsage).toEqual({
        tokensIn: 5000,
        tokensOut: 800,
        costUsd: 0.015,
        durationMs: 8000,
        providerType: 'claude',
        model: 'claude-sonnet-4-20250514',
        planningStage: 'requirement_extraction',
        at: '2026-07-23T10:30:00.000Z',
      });
      expect(res.body.data.history).toHaveLength(2);
      expect(res.body.data.history[0].tokensIn).toBe(5000);
      expect(res.body.data.history[1].tokensIn).toBe(4000);
    });

    it('should return null lastUsage when planning file has no usage data', async () => {
      jest.mocked(require('../db').pool.query).mockImplementation((sql) => {
        if (sql.includes('last_tokens_in')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const res = await request(app)
        .get('/api/v1/tickets/42/planning/01_ARCHITECT_REQUIREMENT.md/usage')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.lastUsage).toBeNull();
      expect(res.body.data.history).toEqual([]);
    });
  });
});
