const request = require('supertest');
const app = require('../index');
const { MODEL_PRICING, getAllModels } = require('../utils/pricing');

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

describe('Pricing API', () => {
  describe('GET /api/v1/pricing/tiers', () => {
    it('should return real MODEL_PRICING data (not stubs)', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/tiers')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBeGreaterThan(0);

      // Each tier should have a model name and pricing
      const tier = res.body.data[0];
      expect(tier).toHaveProperty('model');
      expect(tier).toHaveProperty('pricing');
      expect(tier.pricing).toHaveProperty('input');
      expect(tier.pricing).toHaveProperty('output');

      // Should NOT be the old stub structure
      expect(tier).not.toHaveProperty('id');
      expect(tier).not.toHaveProperty('price');
      expect(tier).not.toHaveProperty('features');
    });

    it('should not include the default model in tiers', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/tiers')
        .set('Authorization', 'Bearer mock-token');

      const models = res.body.data.map(t => t.model);
      expect(models).not.toContain('default');
    });

    it('should include all known models from MODEL_PRICING', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/tiers')
        .set('Authorization', 'Bearer mock-token');

      const models = res.body.data.map(t => t.model);
      const knownModels = getAllModels();
      
      for (const model of knownModels) {
        expect(models).toContain(model);
      }
    });

    it('should return 401 without auth token', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/tiers');

      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/pricing/models', () => {
    it('should return real MODEL_PRICING data', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/models')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('models');
      expect(res.body.data).toHaveProperty('pricing');
    });
  });

  describe('GET /api/v1/pricing/model/:modelName', () => {
    it('should return pricing for a specific model', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/model/gpt-4o')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.model).toBe('gpt-4o');
      expect(res.body.data.pricing).toEqual({ input: 0.0025, output: 0.01 });
    });

    it('should return default pricing for unknown model', async () => {
      const res = await request(app)
        .get('/api/v1/pricing/model/unknown-model')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.pricing).toEqual({ input: 0.001, output: 0.003 });
    });
  });
});
