jest.mock('../utils/crypto', () => ({ encrypt: (v) => v, decrypt: (v) => v }));
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const AgentTokenService = require('../services/AgentTokenService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

function mockClient(handlers) {
  const query = jest.fn((sql, params) => {
    for (const [needle, value] of handlers) {
      if (sql.includes(needle)) {
        return Promise.resolve(typeof value === 'function' ? value(params) : value);
      }
    }
    return Promise.resolve({ rows: [] });
  });
  return { query, release: jest.fn() };
}

describe('AgentNodeService (FR1, FR2, FR3, FR19, FR20, NFR1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('enrolls an owner-scoped node and returns a credential pair', async () => {
    const rawToken = AgentTokenService.generate('enrollment');
    const tokenRow = {
      id: 4,
      owner_id: 7,
      token_hash: AgentTokenService.hash(rawToken),
      max_uses: 1,
      used_count: 0,
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
    };
    const client = mockClient([
      ['FROM agent_node_enrollment_tokens', { rows: [tokenRow] }],
      ['INSERT INTO agent_nodes', {
        rows: [{ id: 12, owner_id: 7, name: 'host-1', status: 'active' }],
      }],
      ['INSERT INTO agent_node_access_tokens', { rows: [] }],
      ['INSERT INTO agent_node_refresh_tokens', { rows: [{ id: 30 }] }],
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await AgentNodeService.enroll({
      token: rawToken,
      name: 'host-1',
      hostname: 'host-1.local',
    });

    expect(result.node.id).toBe(12);
    expect(result.access_token).toMatch(/^at_/);
    expect(result.refresh_token).toMatch(/^ar_/);
    const used = client.query.mock.calls.find(([sql]) =>
      sql.includes('used_count = used_count + 1')
    );
    expect(used[1]).toEqual([4]);
  });

  it('rejects an exhausted enrollment token', async () => {
    const rawToken = AgentTokenService.generate('enrollment');
    const client = mockClient([
      ['FROM agent_node_enrollment_tokens', {
        rows: [{
          id: 4,
          owner_id: 7,
          token_hash: AgentTokenService.hash(rawToken),
          max_uses: 1,
          used_count: 1,
          expires_at: new Date(Date.now() + 60_000),
          revoked_at: null,
        }],
      }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(
      AgentNodeService.enroll({ token: rawToken, name: 'host' })
    ).rejects.toMatchObject({ code: 'ENROLLMENT_TOKEN_EXHAUSTED' });
  });

  it('revokes the family when a rotated refresh token is reused', async () => {
    const rawToken = AgentTokenService.generate('refresh');
    const row = {
      id: 9,
      node_id: 12,
      token_hash: AgentTokenService.hash(rawToken),
      family_id: '11111111-1111-1111-1111-111111111111',
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      rotated_at: new Date(),
    };
    const client = mockClient([
      ['FROM agent_node_refresh_tokens WHERE token_prefix', { rows: [row] }],
      ['FROM agent_nodes WHERE id = $1 FOR UPDATE', { rows: [{ id: 12 }] }],
      ['FROM agent_node_refresh_tokens WHERE id = $1 FOR UPDATE', { rows: [row] }],
    ]);
    pool.connect.mockResolvedValue(client);

    await expect(AgentNodeService.refresh({ token: rawToken })).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE agent_node_access_tokens SET revoked_at')
      )
    ).toBe(true);
    expect(
      client.query.mock.calls.some(([sql]) =>
        sql.includes('UPDATE agent_node_refresh_tokens SET revoked_at')
      )
    ).toBe(true);
  });

  it('reactivates a revoked grant instead of inserting a duplicate', async () => {
    const client = mockClient([
      ['UPDATE agent_node_grants SET revoked_at = NULL', {
        rows: [{ id: 3, node_id: 12, project_id: 5, role: 'worker', revoked_at: null }],
      }],
    ]);
    pool.connect.mockResolvedValue(client);

    const grant = await AgentNodeService.createGrant(12, 5, 'worker');
    expect(grant.id).toBe(3);
    expect(
      client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agent_node_grants'))
    ).toBe(false);
  });

  it('rejects a runtime whose model is not tagged for its role', async () => {
    const client = mockClient([
      ['FROM agent_node_grants', { rows: [{ id: 1 }] }],
    ]);
    pool.connect.mockResolvedValue(client);
    jest.spyOn(AgentNodeService, 'resolveModel').mockResolvedValue({
      id: 8,
      model: 'm',
      roles: ['reviewer'],
    });

    await expect(
      AgentNodeService.declareRuntimes(
        { id: 12, owner_id: 7 },
        [{ role: 'worker', modelRef: 'cred/m', projectId: 5 }]
      )
    ).rejects.toMatchObject({ code: 'ROLE_NOT_ALLOWED' });
    expect(client.query.mock.calls.some(([sql]) => sql === 'ROLLBACK')).toBe(true);
  });

  it('requires a grant before declaring a runtime project', async () => {
    const client = mockClient([]);
    pool.connect.mockResolvedValue(client);

    await expect(
      AgentNodeService.declareRuntimes(
        { id: 12, owner_id: 7 },
        [{ role: 'worker', modelRef: 'cred/m', projectId: 5 }]
      )
    ).rejects.toMatchObject({ code: 'GRANT_REQUIRED' });
  });

  it('returns a cached refresh response for the same idempotency key', async () => {
    const rawToken = AgentTokenService.generate('refresh');
    const payload = { access_token: 'at_cached', refresh_token: 'ar_cached' };
    const row = {
      id: 9,
      node_id: 12,
      token_hash: AgentTokenService.hash(rawToken),
      family_id: '11111111-1111-1111-1111-111111111111',
      expires_at: new Date(Date.now() + 60_000),
      revoked_at: null,
      rotated_at: new Date(),
    };
    const client = mockClient([
      ['FROM agent_node_refresh_tokens WHERE token_prefix', { rows: [row] }],
      ['FROM agent_nodes WHERE id = $1 FOR UPDATE', { rows: [{ id: 12 }] }],
      ['FROM agent_node_refresh_tokens WHERE id = $1 FOR UPDATE', { rows: [row] }],
      ['FROM agent_node_refresh_replays', {
        rows: [{ response_ciphertext: JSON.stringify(payload), expires_at: new Date(Date.now() + 60_000) }],
      }],
    ]);
    pool.connect.mockResolvedValue(client);

    const result = await AgentNodeService.refresh({
      token: rawToken,
      idempotencyKey: 'idem-key-1234567890',
    });
    expect(result).toEqual(payload);
  });

  it('lists grants using the persisted created_at column', async () => {
    pool.query.mockResolvedValue({ rows: [{ id: 1, node_id: 12 }] });
    const grants = await AgentNodeService.listGrants(12);
    expect(grants).toHaveLength(1);
    const [sql] = pool.query.mock.calls.find(([text]) => text.includes('FROM agent_node_grants'));
    expect(sql).toContain('ORDER BY created_at DESC');
  });

  it('config never selects provider secrets', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_nodes')) return Promise.resolve({ rows: [{ id: 12 }] });
      return Promise.resolve({ rows: [] });
    });

    await AgentNodeService.config(12);
    for (const [sql] of pool.query.mock.calls) {
      expect(sql).not.toMatch(/api_key_encrypted/i);
    }
  });
});
