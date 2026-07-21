const request = require('supertest');
const app = require('src/index');

describe('Metrics API', () => {
  describe('GET /metrics authentication', () => {
    it('returns 200 when no METRICS_TOKEN is set (no auth required)', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('returns 401 when METRICS_TOKEN is set and wrong token provided', async () => {
      process.env.METRICS_TOKEN = 'test-metrics-token-123';
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
      delete process.env.METRICS_TOKEN;
    });

    it('returns 200 when METRICS_TOKEN is set and correct token provided', async () => {
      process.env.METRICS_TOKEN = 'test-metrics-token-456';
      const res = await request(app)
        .get('/metrics')
        .set('x-metrics-token', 'test-metrics-token-456');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
      delete process.env.METRICS_TOKEN;
    });

    it('returns 401 when METRICS_TOKEN is set but header is missing', async () => {
      process.env.METRICS_TOKEN = 'test-metrics-token-789';
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      delete process.env.METRICS_TOKEN;
    });
  });

  describe('GET /api/metrics authentication', () => {
    it('returns 200 without auth header (no auth on JSON endpoint)', async () => {
      process.env.METRICS_TOKEN = 'test-api-metrics-token';
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      delete process.env.METRICS_TOKEN;
    });
  });

  describe('GET /metrics content-type', () => {
    it('returns text/plain; charset=utf-8', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
    });
  });

  describe('GET /api/metrics content-type', () => {
    it('returns application/json', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
    });

    it('returns proper JSON structure with success wrapper', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body).toHaveProperty('success', true);
      expect(res.body).toHaveProperty('data');
      expect(res.body.data).toHaveProperty('uptime');
      expect(res.body.data).toHaveProperty('memoryUsage');
      expect(res.body.data).toHaveProperty('timestamp');
      expect(res.body.data).toHaveProperty('database');
    });

    it('returns database stats with pool information', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body.data.database).toBeDefined();
      expect(res.body.data.database).toHaveProperty('status');
    });
  });
});
