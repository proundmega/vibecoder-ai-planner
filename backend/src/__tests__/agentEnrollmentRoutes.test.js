const express = require('express');
const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');
const AgentEnrollmentService = require('../services/AgentEnrollmentService');
const PermissionService = require('../services/PermissionService');
const rateLimit = require('../middleware/agentEnrollmentRateLimit');
const { requireSecureTransport } = require('../api/agentEnrollment');

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
  verify: jest.fn().mockReturnValue({ userId: '7', role: 'project_admin', email: 'u@test.com' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

function asUser(userId, role) {
  jwt.verify.mockReturnValue({ userId, role, email: 'u@test.com' });
}

describe('Agent enrollment routes (FR1, FR2, FR12, FR14, NFR2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AGENT_ENROLLMENT_ENABLED = 'true';
    PermissionService.hasAnyPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
    asUser('7', 'project_admin');
  });

  afterEach(() => {
    delete process.env.AGENT_ENROLLMENT_ENABLED;
    jest.restoreAllMocks();
  });

  it('returns 404 for every enrollment route when the feature is disabled', async () => {
    process.env.AGENT_ENROLLMENT_ENABLED = 'false';

    const res = await request(app).get('/api/v1/agent-enrollment/tokens?project_id=3');

    expect(res.statusCode).toBe(404);
  });

  it('mints a join token for a project owner and returns the raw token once', async () => {
    pool.query.mockImplementation(sql => {
      if (sql.includes('SELECT id, owner_id FROM projects')) {
        return Promise.resolve({ rows: [{ id: 3, owner_id: '7' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    jest.spyOn(AgentEnrollmentService, 'mint').mockResolvedValue({
      id: 10,
      project_id: 3,
      provider_id: null,
      name: 'worker',
      max_uses: 1,
      expires_at: new Date(),
      token: 'enr_secret_once',
    });

    const res = await request(app)
      .post('/api/v1/agent-enrollment/tokens')
      .set('Authorization', 'Bearer mock-token')
      .send({ project_id: 3, name: 'worker' });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.token).toBe('enr_secret_once');
  });

  it('rejects minting for a project the user cannot access', async () => {
    pool.query.mockImplementation(sql => {
      if (sql.includes('SELECT id, owner_id FROM projects')) {
        return Promise.resolve({ rows: [{ id: 3, owner_id: '99' }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/agent-enrollment/tokens')
      .set('Authorization', 'Bearer mock-token')
      .send({ project_id: 3, name: 'worker' });

    expect(res.statusCode).toBe(403);
  });

  it('lists token metadata and never includes hashes', async () => {
    pool.query.mockImplementation(sql => {
      if (sql.includes('SELECT id, owner_id FROM projects')) {
        return Promise.resolve({ rows: [{ id: 3, owner_id: '7' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    jest.spyOn(AgentEnrollmentService, 'list').mockResolvedValue([
      { id: 1, name: 'join', max_uses: 1, used_count: 0, revoked_at: null },
    ]);

    const res = await request(app)
      .get('/api/v1/agent-enrollment/tokens?project_id=3')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.data[0]).not.toHaveProperty('token_hash');
    expect(res.body.data[0]).not.toHaveProperty('token');
  });

  it('revokes a join token', async () => {
    pool.query.mockImplementation(sql => {
      if (sql.includes('SELECT id, project_id, revoked_at FROM agent_enrollment_tokens')) {
        return Promise.resolve({ rows: [{ id: 1, project_id: 3, revoked_at: null }] });
      }
      if (sql.includes('SELECT id, owner_id FROM projects')) {
        return Promise.resolve({ rows: [{ id: 3, owner_id: '7' }] });
      }
      return Promise.resolve({ rows: [] });
    });
    jest.spyOn(AgentEnrollmentService, 'revoke').mockResolvedValue({ id: 1, revoked_at: new Date() });

    const res = await request(app)
      .delete('/api/v1/agent-enrollment/tokens/1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('collapses join-token failures into a generic 401', async () => {
    jest.spyOn(AgentEnrollmentService, 'enroll').mockRejectedValue(
      new AgentEnrollmentService.EnrollmentError(401, 'ENROLLMENT_TOKEN_EXPIRED', 'expired')
    );
    jest.spyOn(AgentEnrollmentService, 'audit').mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/v1/agent-enrollment/enroll')
      .send({ token: 'enr_unknownvalue1234567890', name: 'worker' });

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('ENROLLMENT_TOKEN_INVALID');
    expect(JSON.stringify(res.body)).not.toContain('enr_unknownvalue');
  });

  it('returns 500 for an internal enrollment failure, not an invalid-token 401', async () => {
    jest.spyOn(AgentEnrollmentService, 'enroll').mockRejectedValue(new Error('database unavailable'));

    const res = await request(app)
      .post('/api/v1/agent-enrollment/enroll')
      .send({ token: 'enr_validvalue1234567890', name: 'worker' });

    expect(res.statusCode).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_SERVER_ERROR');
  });

  it('returns the credential pair on a successful enroll', async () => {
    jest.spyOn(AgentEnrollmentService, 'enroll').mockResolvedValue({
      agent_id: 42,
      project_id: 3,
      access_token: 'at_new',
      refresh_token: 'ar_new',
      access_expires_at: new Date(),
      refresh_expires_at: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/agent-enrollment/enroll')
      .send({ token: 'enr_validvalue1234567890', name: 'worker' });

    expect(res.statusCode).toBe(201);
    expect(res.body.data.access_token).toBe('at_new');
  });

  it('reports refresh reuse with a specific error code', async () => {
    jest.spyOn(AgentEnrollmentService, 'refresh').mockRejectedValue(
      Object.assign(new Error('reused'), { status: 401, code: 'REFRESH_TOKEN_REUSED' })
    );

    const res = await request(app)
      .post('/api/v1/agent-enrollment/refresh')
      .send({ refresh_token: 'ar_reusedvalue123456789', idempotency_key: 'idem-1234567890123456' });

    expect(res.statusCode).toBe(401);
    expect(res.body.error.code).toBe('REFRESH_TOKEN_REUSED');
  });

  it('requires an idempotency key on refresh', async () => {
    jest.spyOn(AgentEnrollmentService, 'refresh').mockRejectedValue(
      Object.assign(new Error('idempotency_key is required'), {
        status: 400,
        code: 'IDEMPOTENCY_KEY_REQUIRED',
      })
    );

    const res = await request(app)
      .post('/api/v1/agent-enrollment/refresh')
      .send({ refresh_token: 'ar_reusedvalue123456789' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });
});

describe('requireSecureTransport (FR14)', () => {
  const originalEnv = process.env.NODE_ENV;

  function call(reqOverrides) {
    const req = {
      secure: false,
      ip: '203.0.113.10',
      socket: { remoteAddress: '203.0.113.10' },
      get: () => undefined,
      ...reqOverrides,
    };
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    const next = jest.fn();
    requireSecureTransport(req, res, next);
    return { res, next };
  }

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    delete process.env.ALLOW_INSECURE_AGENT_ENROLLMENT;
  });

  it('rejects plain HTTP from a non-loopback address', () => {
    process.env.NODE_ENV = 'production';
    const { res, next } = call({});
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('TLS_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts HTTPS reported by Express (trust proxy configured)', () => {
    process.env.NODE_ENV = 'production';
    expect(call({ secure: true }).next).toHaveBeenCalled();
  });

  it('rejects a spoofed X-Forwarded-Proto when trust proxy is not configured', () => {
    process.env.NODE_ENV = 'production';
    const { res, next } = call({
      get: name => (name === 'x-forwarded-proto' ? 'https' : undefined),
    });
    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('TLS_REQUIRED');
    expect(next).not.toHaveBeenCalled();
  });

  it('allows loopback and the explicit insecure-testing flag', () => {
    process.env.NODE_ENV = 'production';
    expect(call({ ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } }).next).toHaveBeenCalled();

    process.env.ALLOW_INSECURE_AGENT_ENROLLMENT = '1';
    expect(call({ ip: '203.0.113.10', socket: { remoteAddress: '203.0.113.10' } }).next).toHaveBeenCalled();
  });
});

describe('agentEnrollmentRateLimit (FR12)', () => {
  beforeEach(() => {
    rateLimit._reset();
  });

  afterEach(() => {
    delete process.env.INTEGRATION_TESTS;
    rateLimit._reset();
  });

  it('returns 429 after the burst allowance is exhausted', async () => {
    const limited = express();
    limited.use(express.json());
    limited.post('/enroll', rateLimit({ max: 2, keyFn: () => 'prefix' }), (_req, res) => res.json({ ok: true }));

    expect((await request(limited).post('/enroll').send({})).statusCode).toBe(200);
    expect((await request(limited).post('/enroll').send({})).statusCode).toBe(200);
    const third = await request(limited).post('/enroll').send({});
    expect(third.statusCode).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });

  it('cannot bypass the limit by varying the token prefix', async () => {
    let counter = 0;
    const limited = express();
    limited.use(express.json());
    limited.post('/enroll', rateLimit({ max: 2, keyFn: () => `prefix-${++counter}` }), (_req, res) => res.json({ ok: true }));

    expect((await request(limited).post('/enroll').send({})).statusCode).toBe(200);
    expect((await request(limited).post('/enroll').send({})).statusCode).toBe(200);
    expect((await request(limited).post('/enroll').send({})).statusCode).toBe(429);
  });

  it('bounds the bucket map even with unique keys', () => {
    const limiter = rateLimit({ max: 100000 });
    const res = {
      set: () => res,
      status: () => res,
      json: () => res,
    };
    for (let i = 0; i < rateLimit.MAX_BUCKETS + 50; i++) {
      limiter({ ip: `10.0.${i >> 8}.${i & 255}`, socket: {} }, res, () => {});
    }
    expect(rateLimit._size()).toBeLessThanOrEqual(rateLimit.MAX_BUCKETS);
  });
});
