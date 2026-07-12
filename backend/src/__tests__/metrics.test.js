const request = require('supertest');
const app = require('src/index');

describe('Prometheus Metrics', () => {
  it('GET /metrics returns Prometheus format', async () => {
    const res = await request(app).get('/metrics');

    expect(res.status).toBe(200);
    expect(res.get('Content-Type')).toContain('text/plain');
    expect(res.text).toContain('# HELP');
    expect(res.text).toContain('# TYPE');
  });

  it('GET /api/metrics returns JSON format', async () => {
    const res = await request(app).get('/api/metrics');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.uptime).toBeDefined();
    expect(res.body.data.memoryUsage).toBeDefined();
  });

  it('http_request_duration_seconds histogram is populated', async () => {
    await request(app).get('/health');
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('http_request_duration_seconds');
  });

  it('http_requests_total counter is populated', async () => {
    await request(app).get('/health');
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('http_requests_total');
  });

  it('nodejs_heap_size_used_bytes is present (process metric)', async () => {
    const res = await request(app).get('/metrics');

    expect(res.text).toContain('nodejs_heap_size_used_bytes');
  });
});
