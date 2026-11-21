const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/TemplateService');
jest.mock('../services/TicketPlanningService');
jest.mock('../models/project');

describe('legacy agent/provider/auth surface is removed', () => {
  test.each([
    ['GET', '/api/v1/agents'],
    ['GET', '/api/v1/agents/7'],
    ['POST', '/api/v1/agents/create'],
    ['GET', '/api/v1/agents-status/7/heartbeat'],
    ['POST', '/api/v1/agent-enrollment/enroll'],
    ['POST', '/api/v1/agent-enrollment/refresh'],
    ['GET', '/api/v1/agent-enrollment/tokens'],
    ['GET', '/api/v1/providers'],
    ['GET', '/api/v1/pool'],
    ['POST', '/api/v1/usage/agents/3/usage'],
  ])('%s %s returns 404', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.statusCode).toBe(404);
  });

  test('runtime-owned surfaces remain mounted', async () => {
    const resolve = await request(app)
      .post('/api/v1/providers/resolve')
      .send({ phase: 'review' });
    expect(resolve.statusCode).toBe(401);

    const nodes = await request(app).get('/api/v1/agent-nodes');
    expect(nodes.statusCode).toBe(401);

    const compute = await request(app).get('/api/v1/compute-nodes');
    expect(compute.statusCode).toBe(401);
  });
});
