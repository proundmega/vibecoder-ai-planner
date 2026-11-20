const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const AgentNodeService = require('../services/AgentNodeService');
const PermissionService = require('../services/PermissionService');

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

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: '7', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

function asUser(userId, role) {
  jwt.verify.mockReturnValue({ userId, role });
}

describe('Agent node routes (FR1, FR3, FR20, FR21, NFR1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_ENROLLMENT_ENABLED = 'true';
    PermissionService.hasAnyPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
    asUser('7', 'project_admin');
  });

  afterEach(() => {
    delete process.env.AGENT_ENROLLMENT_ENABLED;
  });

  it('enrolls a node and returns the one-time credential pair', async () => {
    jest.spyOn(AgentNodeService, 'enroll').mockResolvedValue({
      node: { id: 12, name: 'host-1' },
      access_token: 'at_secret',
      refresh_token: 'ar_secret',
    });

    const res = await request(app)
      .post('/api/v1/agent-nodes/enroll')
      .send({ token: 'enr_valid_token_value_123', name: 'host-1' });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.access_token).toBe('at_secret');
  });

  it('binds node config to the presented credential', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: { id: 12, owner_id: 7 },
    });
    jest.spyOn(AgentNodeService, 'config').mockResolvedValue({
      node: { id: 12 },
      grants: [],
      runtimes: [],
    });

    const ok = await request(app)
      .get('/api/v1/agent-nodes/12/config')
      .set('X-API-Key', 'at_valid');
    expect(ok.statusCode).toBe(200);

    const foreign = await request(app)
      .get('/api/v1/agent-nodes/99/config')
      .set('X-API-Key', 'at_valid');
    expect(foreign.statusCode).toBe(404);
  });

  it('hides a node from a non-owner JWT mutation', async () => {
    const revoke = jest.spyOn(AgentNodeService, 'revoke');
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_nodes')) {
        return Promise.resolve({ rows: [{ id: 12, owner_id: 99 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/agent-nodes/12/revoke')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(404);
    expect(revoke).not.toHaveBeenCalled();
  });

  it('rejects a grant id that does not belong to the node', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_nodes')) {
        return Promise.resolve({ rows: [{ id: 12, owner_id: 7 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .delete('/api/v1/agent-nodes/12/grants/999')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(404);
  });
});
