const { Pool } = require('pg');
const HarnessRunService = require('../../services/HarnessRunService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let ownerId;
let projectId;
let agentA;
let agentB;
let ticketA;
let ticketB;

async function insertAgent(name) {
  const result = await pool.query(
    'INSERT INTO agents (name, owner_id) VALUES ($1, $2) RETURNING id',
    [name, ownerId]
  );
  return result.rows[0].id;
}

async function insertTicket(title, agentId) {
  const result = await pool.query(
    `INSERT INTO tickets
       (project_id, title, status, owner_id, assigned_agent_id, locked_at)
     VALUES ($1, $2, 'in_progress', $3, $4, NOW())
     RETURNING id`,
    [projectId, title, ownerId, agentId]
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
    agentA = await insertAgent(`quota-agent-a-${suffix}`);
    agentB = await insertAgent(`quota-agent-b-${suffix}`);
    ticketA = await insertTicket(`Quota A ${suffix}`, agentA);
    ticketB = await insertTicket(`Quota B ${suffix}`, agentB);

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
      await pool.query('DELETE FROM agents WHERE owner_id = $1', [ownerId]);
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
        agentId: agentA,
        branch: `quota/a/${suffix}`,
      }),
      HarnessRunService.startRun({
        ticketId: ticketB,
        agentId: agentB,
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
