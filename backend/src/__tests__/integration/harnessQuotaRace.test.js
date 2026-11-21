const { Pool } = require('pg');
const HarnessRunService = require('../../services/HarnessRunService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let ownerId;
let projectId;
let nodeId;
let credentialId;
let modelId;
let runtimeA;
let runtimeB;
let ticketA;
let ticketB;

async function insertRuntime(name) {
  const result = await pool.query(
    `INSERT INTO agent_runtimes
       (node_id, name, role, model_id, status, current_project_id)
     VALUES ($1, $2, 'worker', $3, 'running', $4) RETURNING id`,
    [nodeId, name, modelId, projectId]
  );
  return result.rows[0].id;
}

async function insertTicket(title, runtimeId) {
  const result = await pool.query(
    `INSERT INTO tickets
       (project_id, title, status, owner_id, assigned_runtime_id, locked_at)
     VALUES ($1, $2, 'in_progress', $3, $4, NOW())
     RETURNING id`,
    [projectId, title, ownerId, runtimeId]
  );
  return result.rows[0].id;
}

describe('Harness daily quota reservation race (real DB)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Quota Owner', 'x', 'user') RETURNING id`,
      [`quota_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;
    const project = await pool.query(
      'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
      [`Quota Project ${suffix}`, ownerId]
    );
    projectId = project.rows[0].id;
    const node = await pool.query(
      `INSERT INTO agent_nodes (owner_id, name, status)
       VALUES ($1, $2, 'active') RETURNING id`,
      [ownerId, `quota-node-${suffix}`]
    );
    nodeId = node.rows[0].id;
    const credential = await pool.query(
      `INSERT INTO provider_credentials
         (owner_id, name, provider_type, api_key_encrypted)
       VALUES ($1, $2, 'opencode', 'x') RETURNING id`,
      [ownerId, `quota-credential-${suffix}`]
    );
    credentialId = credential.rows[0].id;
    const model = await pool.query(
      `INSERT INTO provider_models (credential_id, model, source, roles, status)
       VALUES ($1, 'quota-model', 'manual', ARRAY['worker'], 'verified') RETURNING id`,
      [credentialId]
    );
    modelId = model.rows[0].id;
    runtimeA = await insertRuntime(`quota-runtime-a-${suffix}`);
    runtimeB = await insertRuntime(`quota-runtime-b-${suffix}`);
    ticketA = await insertTicket(`Quota A ${suffix}`, runtimeA);
    ticketB = await insertTicket(`Quota B ${suffix}`, runtimeB);

    await pool.query(
      `INSERT INTO harness_budget_policies
         (project_id, scope, max_cost_usd, daily_cost_usd,
          project_max_concurrent_runs, agent_max_concurrent_runs)
       VALUES ($1, 'project', 5, 3, 4, 1)`,
      [projectId]
    );
  });

  afterAll(async () => {
    if (projectId) {
      await pool.query('DELETE FROM harness_runs WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM tickets WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM agent_runtimes WHERE node_id = $1', [nodeId]);
      await pool.query('DELETE FROM agent_nodes WHERE id = $1', [nodeId]);
      await pool.query('DELETE FROM provider_models WHERE credential_id = $1', [credentialId]);
      await pool.query('DELETE FROM provider_credentials WHERE id = $1', [credentialId]);
      await pool.query('DELETE FROM harness_budget_policies WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    }
    if (ownerId) {
      await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    }
    await pool.end();
  });

  test('two concurrent starts cannot reserve more than the daily limit', async () => {
    const results = await Promise.allSettled([
      HarnessRunService.startRun({
        ticketId: ticketA,
        runtimeId: runtimeA,
        branch: `quota/a/${suffix}`,
      }),
      HarnessRunService.startRun({
        ticketId: ticketB,
        runtimeId: runtimeB,
        branch: `quota/b/${suffix}`,
      }),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason.message)).toMatch(
      /daily project budget is fully reserved|daily project budget exhausted/
    );

    const runs = await pool.query(
      `SELECT budget_reserved_usd FROM harness_runs
       WHERE project_id = $1 AND status = 'running'`,
      [projectId]
    );
    expect(runs.rows).toHaveLength(1);
    expect(Number(runs.rows[0].budget_reserved_usd)).toBe(3);
  });
});
