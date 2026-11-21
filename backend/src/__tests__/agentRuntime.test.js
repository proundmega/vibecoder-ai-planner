jest.mock('../utils/crypto', () => ({ encrypt: (v) => v, decrypt: (v) => v }));
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');

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

describe('AgentNodeService runtime records (FR10)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('FR10 persists a runtime with a single active project assignment', async () => {
    const client = mockClient([
      ['SELECT id FROM agent_nodes WHERE id = $1 FOR UPDATE', { rows: [{ id: 12 }] }],
      ['FROM agent_node_grants', { rows: [{ project_id: 5 }] }],
      ['FROM provider_models pm', {
        rows: [{
          id: 3,
          model: 'claude-sonnet',
          effort: 'medium',
          roles: ['worker'],
          credential_name: 'acme',
          owner_id: 7,
        }],
      }],
      ['INSERT INTO agent_runtimes', (params) => ({
        rows: [{
          id: 44,
          node_id: params[0],
          name: params[1],
          role: params[2],
          model_id: params[3],
          concurrency: params[4],
          effort: params[5],
          status: 'pending',
          current_project_id: params[6],
        }],
      })],
      ['count(*)::int AS n FROM agent_runtimes', { rows: [{ n: 1 }] }],
    ]);
    pool.connect.mockResolvedValue(client);

    const [runtime] = await AgentNodeService.declareRuntimes(
      { id: 12, owner_id: 7 },
      [{
        role: 'worker',
        modelRef: 'acme/claude-sonnet',
        projectId: 5,
        name: 'build',
        concurrency: 2,
        effort: 'high',
      }]
    );

    expect(runtime).toMatchObject({
      id: 44,
      node_id: 12,
      name: 'build-1',
      role: 'worker',
      model_id: 3,
      concurrency: 2,
      effort: 'high',
      status: 'pending',
      current_project_id: 5,
    });

    const insert = client.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO agent_runtimes'));
    expect(insert[1]).toEqual([12, 'build-1', 'worker', 3, 2, 'high', 5]);
    expect(client.query.mock.calls.some(([sql]) => sql === 'COMMIT')).toBe(true);
  });

  it('FR10 replaces the single project assignment on heartbeat', async () => {
    const client = mockClient([
      ['SELECT id FROM agent_nodes WHERE id = $1 FOR UPDATE', { rows: [{ id: 12 }] }],
      ['SELECT * FROM agent_runtimes WHERE id = $1 AND node_id = $2', {
        rows: [{ id: 3, status: 'running', role: 'worker', current_project_id: 5 }],
      }],
      ['FROM agent_node_grants', { rows: [{ project_id: 9 }] }],
      ['UPDATE agent_runtimes', (params) => ({
        rows: [{ id: 3, current_project_id: params[3] }],
      })],
      ['UPDATE agent_nodes', { rows: [] }],
    ]);
    pool.connect.mockResolvedValue(client);

    const updated = await AgentNodeService.heartbeat(
      { id: 12 },
      3,
      { currentProjectId: 9 }
    );

    expect(updated.current_project_id).toBe(9);
    const update = client.query.mock.calls.find(([sql]) => sql.includes('UPDATE agent_runtimes'));
    expect(update[0]).toContain('current_project_id = $4');
    expect(update[1]).toEqual([3, 12, null, 9]);
    expect(client.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO agent_runtimes'))).toBe(false);
  });

  it('FR10 stores the effort override and leaves the model default when absent', async () => {
    const client = mockClient([
      ['SELECT id FROM agent_nodes WHERE id = $1 FOR UPDATE', { rows: [{ id: 12 }] }],
      ['FROM provider_models pm', {
        rows: [{
          id: 3,
          model: 'claude-sonnet',
          effort: 'medium',
          roles: ['worker', 'reviewer'],
          credential_name: 'acme',
          owner_id: 7,
        }],
      }],
      ['INSERT INTO agent_runtimes', (params) => ({
        rows: [{ id: params[1] === 'override-1' ? 45 : 46, effort: params[5] }],
      })],
      ['count(*)::int AS n FROM agent_runtimes', { rows: [{ n: 2 }] }],
    ]);
    pool.connect.mockResolvedValue(client);

    const [override, fallback] = await AgentNodeService.declareRuntimes(
      { id: 12, owner_id: 7 },
      [
        { role: 'worker', modelRef: 'acme/claude-sonnet', name: 'override', effort: 'max' },
        { role: 'reviewer', modelRef: 'acme/claude-sonnet', name: 'fallback' },
      ]
    );

    expect(override.effort).toBe('max');
    expect(fallback.effort).toBe(null);
  });
});
