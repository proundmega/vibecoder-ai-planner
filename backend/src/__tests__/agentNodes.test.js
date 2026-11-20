jest.mock('../utils/crypto', () => ({ decrypt: () => 'sk-test', encrypt: (v) => v }));
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

  it('requires an idempotency key when refreshing', async () => {
    const res = await request(app)
      .post('/api/v1/agent-nodes/refresh')
      .send({ refresh_token: 'ar_valid_refresh_token_value' });
    expect(res.statusCode).toBe(400);
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

  it('returns the resolved provider config and denies unsafe states', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: { id: 12, owner_id: 7 },
    });

    const base = {
      id: 3,
      name: 'worker-1',
      role: 'worker',
      node_id: 12,
      runtime_status: 'running',
      credential_id: 4,
      credential_status: 'active',
      model: 'm',
      model_status: 'verified',
      model_effort: 'medium',
      effort: null,
      max_tokens: 4096,
      provider_type: 'claude',
      base_url: null,
      api_key_encrypted: 'enc',
    };

    for (const [label, row] of [
      ['unverified model', { ...base, model_status: 'unverified' }],
      ['disabled credential', { ...base, credential_status: 'disabled' }],
      ['stopped runtime', { ...base, runtime_status: 'stopped' }],
    ]) {
      pool.query.mockImplementation((sql) => {
        if (sql.includes('FROM agent_runtimes r')) return Promise.resolve({ rows: [row] });
        return Promise.resolve({ rows: [] });
      });
      const res = await request(app)
        .get('/api/v1/agent-nodes/12/runtimes/3/provider-config')
        .set('X-API-Key', 'at_valid');
      expect(`${label}:${res.statusCode}`).toBe(`${label}:404`);
    }

    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_runtimes r')) return Promise.resolve({ rows: [base] });
      return Promise.resolve({ rows: [] });
    });
    const ok = await request(app)
      .get('/api/v1/agent-nodes/12/runtimes/3/provider-config')
      .set('X-API-Key', 'at_valid');
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.api_key).toBe('sk-test');
    expect(ok.headers['cache-control']).toBe('no-store');
  });

  it('requires both node ownership and project-admin scope for a grant', async () => {
    jest.spyOn(AgentNodeService, 'createGrant').mockResolvedValue({ id: 2 });

    // Owner, global project_admin, but not a project member -> 403.
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_nodes')) {
        return Promise.resolve({ rows: [{ id: 12, owner_id: 7 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const denied = await request(app)
      .post('/api/v1/agent-nodes/12/grants')
      .set('Authorization', 'Bearer mock-token')
      .send({ projectId: 5, role: 'worker' });
    expect(denied.statusCode).toBe(403);

    // Owner + member -> 201.
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_nodes')) {
        return Promise.resolve({ rows: [{ id: 12, owner_id: 7 }] });
      }
      if (sql.includes('FROM projects p')) {
        return Promise.resolve({ rows: [{ project_id: 5 }] });
      }
      return Promise.resolve({ rows: [] });
    });
    const allowed = await request(app)
      .post('/api/v1/agent-nodes/12/grants')
      .set('Authorization', 'Bearer mock-token')
      .send({ projectId: 5, role: 'worker' });
    expect(allowed.statusCode).toBe(201);
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
