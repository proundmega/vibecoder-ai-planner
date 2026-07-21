const request = require('supertest');
const app = require('src/index');

describe('Prometheus Metrics', () => {
  describe('GET /metrics (Prometheus format)', () => {
    it('returns 200 with text/plain content-type', async () => {
      const res = await request(app).get('/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/plain');
    });

    it('contains http_request_duration_seconds histogram', async () => {
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('http_request_duration_seconds');
    });

    it('contains http_requests_total counter', async () => {
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('http_requests_total');
    });

    it('contains db_pool_total gauge', async () => {
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('db_pool_total');
    });

    it('contains db_pool_idle gauge', async () => {
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('db_pool_idle');
    });

    it('contains db_pool_waiting gauge', async () => {
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('db_pool_waiting');
    });

    it('http_request_duration_seconds histogram is populated after requests', async () => {
      await request(app).get('/health');
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('http_request_duration_seconds_bucket');
      expect(res.text).toContain('http_request_duration_seconds_sum');
      expect(res.text).toContain('http_request_duration_seconds_count');
    });

    it('http_requests_total counter increments with requests', async () => {
      await request(app).get('/health');
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('http_requests_total{');
    });

    it('includes unmatched label for non-route requests', async () => {
      await request(app).get('/nonexistent-path');
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('path="unmatched"');
    });

    it('db_pool_total gauge reflects actual pool state', async () => {
      const res = await request(app).get('/metrics');
      const poolMatch = res.text.match(/db_pool_total (\d+)/);
      expect(poolMatch).not.toBeNull();
      const poolValue = parseInt(poolMatch[1]);
      expect(poolValue).toBeGreaterThanOrEqual(0);
    });

    it('has histogram buckets with le= labels', async () => {
      await request(app).get('/health');
      const res = await request(app).get('/metrics');
      expect(res.text).toContain('le="0.005"');
      expect(res.text).toContain('le="0.01"');
      expect(res.text).toContain('le="10"');
    });

    it('excludes nodejs_* metrics in test mode', async () => {
      const res = await request(app).get('/metrics');
      expect(res.text).not.toContain('nodejs_heap_used_bytes');
    });
  });

  describe('GET /api/metrics (JSON format)', () => {
    it('returns 200 with application/json content-type', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/json');
    });

    it('returns success: true with data object', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeDefined();
    });

    it('contains uptime field', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body.data.uptime).toBeDefined();
      expect(typeof res.body.data.uptime).toBe('number');
    });

    it('contains memoryUsage field', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body.data.memoryUsage).toBeDefined();
      expect(res.body.data.memoryUsage.rss).toBeDefined();
    });

    it('contains timestamp field', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body.data.timestamp).toBeDefined();
      expect(new Date(res.body.data.timestamp).getTime()).not.toBeNaN();
    });

    it('contains database field with pool stats', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.body.data.database).toBeDefined();
      expect(res.body.data.database.status).toBeDefined();
    });
  });
});
