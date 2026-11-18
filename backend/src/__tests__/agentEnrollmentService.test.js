const { pool } = require('../db');
const AgentEnrollmentService = require('../services/AgentEnrollmentService');
const AgentTokenService = require('../services/AgentTokenService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));
jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn(value => `enc:${Buffer.from(value).toString('base64')}`),
  decrypt: jest.fn(value => Buffer.from(value.slice(4), 'base64').toString()),
  maskToken: jest.fn(),
}));

function mockClient(handlers) {
  const query = jest.fn((sql, params) => {
    for (const [needle, value] of handlers) {
      if (sql.includes(needle)) return Promise.resolve(value);
    }
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn() };
}

const baseTokenRow = overrides => ({
  id: 5,
  project_id: 3,
  provider_id: 2,
  name: 'worker',
  max_uses: 1,
  used_count: 0,
  expires_at: new Date(Date.now() + 60_000),
  revoked_at: null,
  ...overrides,
});

describe('AgentEnrollmentService (FR1–FR3, FR5, FR11, NFR1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('mints a join token and persists only its hash/prefix', async () => {
    pool.query.mockImplementation(sql => {
      if (sql.includes('INSERT INTO agent_enrollment_tokens')) {
        return Promise.resolve({
          rows: [{
            id: 11,
            project_id: 3,
            provider_id: null,
            name: 'worker',
            max_uses: 1,
            used_count: 0,
            expires_at: new Date(Date.now() + 900_000),
            created_at: new Date(),
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await AgentEnrollmentService.mint({
      projectId: 3,
      name: 'worker',
      createdBy: 7,
    });

    expect(result.token).toMatch(/^enr_/);
    const insert = pool.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO agent_enrollment_tokens'));
    expect(insert[1]).toContain(AgentTokenService.hash(result.token));
    expect(insert[1]).toContain(AgentTokenService.lookupPrefix(result.token));
    expect(insert[1]).not.toContain(result.token);
    expect(pool.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agent_auth_events'))).toBe(true);
  });

  it('lists token metadata without secrets', async () => {
    pool.query.mockResolvedValue({
      rows: [{ id: 1, name: 'join', max_uses: 1, used_count: 0, revoked_at: null }],
    });

    const rows = await AgentEnrollmentService.list(3);

    expect(rows[0]).not.toHaveProperty('token');
    expect(rows[0]).not.toHaveProperty('token_hash');
    expect(pool.query.mock.calls[0][0]).not.toContain('token_hash');
  });

  it('enrolls a valid join token exactly once and issues credentials', async () => {
    const raw = AgentTokenService.generate('enrollment');
    const client = mockClient([
      ['SELECT * FROM agent_enrollment_tokens', { rows: [baseTokenRow({ token_hash: AgentTokenService.hash(raw) })] }],
      ['SELECT id, owner_id FROM projects', { rows: [{ id: 3, owner_id: 7 }] }],
      ['INSERT INTO agents', { rows: [{ id: 42, name: 'worker', project_id: 3, provider_id: 2, created_at: new Date() }] }],
      ['INSERT INTO agent_refresh_tokens', { rows: [{ id: 9 }] }],
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await AgentEnrollmentService.enroll({
      token: raw,
      name: 'worker',
      nodeMetadata: { host: 'node-1' },
      ip: '10.0.0.5',
    });

    expect(result.agent_id).toBe(42);
    expect(result.access_token).toMatch(/^at_/);
    expect(result.refresh_token).toMatch(/^ar_/);
    expect(result.project_id).toBe(3);

    const update = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE agent_enrollment_tokens SET used_count'));
    expect(update).toBeTruthy();
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });

  it('rejects an unknown join token and creates no agent', async () => {
    const client = mockClient([
      ['SELECT * FROM agent_enrollment_tokens', { rows: [] }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(AgentEnrollmentService.enroll({
      token: AgentTokenService.generate('enrollment'),
      name: 'worker',
    })).rejects.toMatchObject({ code: 'ENROLLMENT_TOKEN_INVALID' });

    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agents'))).toBe(false);
    expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it.each([
    ['expired', { expires_at: new Date(Date.now() - 1000) }, 'ENROLLMENT_TOKEN_EXPIRED'],
    ['revoked', { revoked_at: new Date() }, 'ENROLLMENT_TOKEN_INVALID'],
    ['exhausted', { max_uses: 1, used_count: 1 }, 'ENROLLMENT_TOKEN_EXHAUSTED'],
  ])('rejects a %s join token without creating rows', async (_label, overrides, code) => {
    const raw = AgentTokenService.generate('enrollment');
    const client = mockClient([
      ['SELECT * FROM agent_enrollment_tokens', { rows: [baseTokenRow({ token_hash: AgentTokenService.hash(raw), ...overrides })] }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(AgentEnrollmentService.enroll({ token: raw, name: 'worker' }))
      .rejects.toMatchObject({ code });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agents'))).toBe(false);
  });

  it('rotates a refresh token and links the replaced row', async () => {
    const raw = AgentTokenService.generate('refresh');
    const lockedRow = {
      id: 21,
      agent_id: 42,
      family_id: '11111111-1111-1111-1111-111111111111',
      token_hash: AgentTokenService.hash(raw),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      rotated_at: null,
    };
    const client = mockClient([
      ['SELECT * FROM agent_refresh_tokens WHERE token_prefix', { rows: [lockedRow] }],
      ['SELECT id FROM agents WHERE id = $1 FOR UPDATE', { rows: [{ id: 42 }] }],
      ['SELECT * FROM agent_refresh_tokens WHERE id = $1 FOR UPDATE', { rows: [lockedRow] }],
      ['INSERT INTO agent_refresh_tokens', { rows: [{ id: 22 }] }],
      ['SELECT project_id FROM agents', { rows: [{ project_id: 3 }] }],
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await AgentEnrollmentService.refresh({ token: raw, idempotencyKey: 'key-1' });
    const lockIndex = client.query.mock.calls.findIndex(([sql]) => sql.includes('FOR UPDATE') && sql.includes('FROM agents'));
    const rotateIndex = client.query.mock.calls.findIndex(([sql]) => sql.includes('UPDATE agent_refresh_tokens SET rotated_at'));
    expect(lockIndex).toBeGreaterThan(-1);
    expect(lockIndex).toBeLessThan(rotateIndex);

    expect(result.access_token).toMatch(/^at_/);
    expect(result.refresh_token).not.toBe(raw);
    const rotate = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE agent_refresh_tokens SET rotated_at'));
    expect(rotate[1][0]).toBe(22);
  });

  it('revokes the whole family when a rotated refresh token is reused', async () => {
    const raw = AgentTokenService.generate('refresh');
    const rotatedRow = {
      id: 21,
      agent_id: 42,
      family_id: '11111111-1111-1111-1111-111111111111',
      token_hash: AgentTokenService.hash(raw),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      rotated_at: new Date(),
    };
    const client = mockClient([
      ['SELECT * FROM agent_refresh_tokens WHERE token_prefix', { rows: [rotatedRow] }],
      ['SELECT id FROM agents WHERE id = $1 FOR UPDATE', { rows: [{ id: 42 }] }],
      ['SELECT * FROM agent_refresh_tokens WHERE id = $1 FOR UPDATE', { rows: [rotatedRow] }],
      ['SELECT response_ciphertext, expires_at', { rows: [] }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(AgentEnrollmentService.refresh({ token: raw, idempotencyKey: 'key-1' }))
      .rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

    const familyRevokes = client.query.mock.calls.filter(([sql]) => sql.includes('SET revoked_at = NOW()'));
    expect(familyRevokes).toHaveLength(2);
    expect(client.query.mock.calls.some(([sql, params]) =>
      sql.includes('INSERT INTO agent_auth_events') && params.includes('refresh.reused'))).toBe(true);
  });

  it('returns the identical pair when the same refresh idempotency key is retried', async () => {
    const raw = AgentTokenService.generate('refresh');
    const cached = {
      agent_id: 42,
      project_id: 3,
      access_token: 'at_cached',
      refresh_token: 'ar_cached',
      access_expires_at: new Date(Date.now() + 60_000).toISOString(),
      refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    };
    const { encrypt } = require('../utils/crypto');
    const cachedRow = {
      id: 21,
      agent_id: 42,
      family_id: '11111111-1111-1111-1111-111111111111',
      token_hash: AgentTokenService.hash(raw),
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      rotated_at: new Date(),
    };
    const client = mockClient([
      ['SELECT * FROM agent_refresh_tokens WHERE token_prefix', { rows: [cachedRow] }],
      ['SELECT id FROM agents WHERE id = $1 FOR UPDATE', { rows: [{ id: 42 }] }],
      ['SELECT * FROM agent_refresh_tokens WHERE id = $1 FOR UPDATE', { rows: [cachedRow] }],
      ['SELECT response_ciphertext, expires_at', {
        rows: [{
          response_ciphertext: encrypt(JSON.stringify(cached)),
          expires_at: new Date(Date.now() + 30_000),
        }],
      }],
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await AgentEnrollmentService.refresh({ token: raw, idempotencyKey: 'key-1' });

    expect(result).toEqual(cached);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agent_refresh_tokens'))).toBe(false);
    expect(client.query.mock.calls.some(([sql, params]) =>
      sql.includes('INSERT INTO agent_auth_events') && params.includes('refresh.replay_cache_hit'))).toBe(true);
  });

  it('requires an idempotency key for a first refresh', async () => {
    const raw = AgentTokenService.generate('refresh');
    const client = mockClient([
      ['SELECT * FROM agent_refresh_tokens WHERE token_prefix', {
        rows: [{
          id: 21,
          agent_id: 42,
          family_id: '11111111-1111-1111-1111-111111111111',
          token_hash: AgentTokenService.hash(raw),
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
          rotated_at: null,
        }],
      }],
      ['SELECT id FROM agents WHERE id = $1 FOR UPDATE', { rows: [{ id: 42 }] }],
      ['SELECT * FROM agent_refresh_tokens WHERE id = $1 FOR UPDATE', {
        rows: [{
          id: 21,
          agent_id: 42,
          family_id: '11111111-1111-1111-1111-111111111111',
          token_hash: AgentTokenService.hash(raw),
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
          rotated_at: null,
        }],
      }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(AgentEnrollmentService.refresh({ token: raw }))
      .rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agent_refresh_tokens'))).toBe(false);
  });

  it('revokes the family when a rotated token is replayed with no key', async () => {
    const raw = AgentTokenService.generate('refresh');
    const client = mockClient([
      ['SELECT * FROM agent_refresh_tokens WHERE token_prefix', {
        rows: [{
          id: 21,
          agent_id: 42,
          family_id: '11111111-1111-1111-1111-111111111111',
          token_hash: AgentTokenService.hash(raw),
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
          rotated_at: new Date(),
        }],
      }],
      ['SELECT id FROM agents WHERE id = $1 FOR UPDATE', { rows: [{ id: 42 }] }],
      ['SELECT * FROM agent_refresh_tokens WHERE id = $1 FOR UPDATE', {
        rows: [{
          id: 21,
          agent_id: 42,
          family_id: '11111111-1111-1111-1111-111111111111',
          token_hash: AgentTokenService.hash(raw),
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
          rotated_at: new Date(),
        }],
      }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(AgentEnrollmentService.refresh({ token: raw }))
      .rejects.toMatchObject({ code: 'REFRESH_TOKEN_REUSED' });

    const familyRevokes = client.query.mock.calls.filter(([sql]) => sql.includes('SET revoked_at = NOW()'));
    expect(familyRevokes).toHaveLength(2);
    expect(client.query.mock.calls.some(([sql, params]) =>
      sql.includes('INSERT INTO agent_auth_events')
      && params.includes('refresh.reused')
      && String(params).includes('missing_idempotency_key'))).toBe(true);
  });

  it('authenticates an access token and reports expired/revoked states', async () => {
    const raw = AgentTokenService.generate('access');
    const row = {
      token_id: 1,
      token_hash: AgentTokenService.hash(raw),
      token_expires_at: new Date(Date.now() + 60_000),
      token_revoked_at: null,
      id: 42,
      name: 'worker',
    };

    pool.query.mockResolvedValueOnce({ rows: [row] });
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(AgentEnrollmentService.authenticateAccessToken(raw))
      .resolves.toMatchObject({ status: 'ok', agent: { id: 42 } });

    pool.query.mockResolvedValueOnce({ rows: [{ ...row, token_expires_at: new Date(Date.now() - 1000) }] });
    await expect(AgentEnrollmentService.authenticateAccessToken(raw))
      .resolves.toMatchObject({ status: 'expired' });

    pool.query.mockResolvedValueOnce({ rows: [{ ...row, token_revoked_at: new Date() }] });
    await expect(AgentEnrollmentService.authenticateAccessToken(raw))
      .resolves.toMatchObject({ status: 'revoked' });
  });
});
