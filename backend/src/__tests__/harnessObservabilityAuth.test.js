const request = require('supertest');
const app = require('../index');

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

describe('harness project observability is JWT-only (NFR2)', () => {
  it.each([
    ['get', '/api/v1/harness/projects/1/runs'],
    ['get', '/api/v1/harness/projects/1/events'],
    ['get', '/api/v1/harness/projects/1/audit'],
    ['get', '/api/v1/harness/projects/1/dashboard'],
    ['get', '/api/v1/harness/projects/1/usage'],
    ['get', '/api/v1/harness/projects/1/privacy-policy'],
    ['put', '/api/v1/harness/projects/1/budget-policy'],
    ['get', '/api/v1/harness/projects/1/kill-switch'],
    ['get', '/api/v1/harness/kill-switch'],
  ])('rejects an agent X-API-Key on %s %s', async (method, path) => {
    const res = await request(app)
      [method](path)
      .set('X-API-Key', 'at_agent');

    expect(res.statusCode).toBe(401);
  });
});
