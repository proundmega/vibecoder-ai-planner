const { Pool } = require('pg');
const HarnessBudgetService = require('../../services/HarnessBudgetService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let ownerId;
let projectId;

describe('Harness budget policy partial updates (real DB)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Budget Owner', 'x', 'user') RETURNING id`,
      [`budget_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;
    const project = await pool.query(
      'INSERT INTO projects (name, owner_id) VALUES ($1, $2) RETURNING id',
      [`Budget Project ${suffix}`, ownerId]
    );
    projectId = project.rows[0].id;
  });

  afterAll(async () => {
    if (projectId) {
      await pool.query('DELETE FROM harness_budget_policies WHERE project_id = $1', [projectId]);
      await pool.query('DELETE FROM projects WHERE id = $1', [projectId]);
    }
    if (ownerId) {
      await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    }
    await pool.end();
  });

  test('a partial update preserves omitted fields and applies column defaults on insert', async () => {
    const created = await HarnessBudgetService.upsertPolicy({
      projectId,
      policy: { maxCostUsd: 10 },
    });
    expect(Number(created.max_cost_usd)).toBe(10);
    expect(Number(created.warn_ratio)).toBe(0.8);
    expect(created.routing_policy).toBe('free_then_paid');
    expect(Number(created.complexity_threshold)).toBe(3);

    const updated = await HarnessBudgetService.upsertPolicy({
      projectId,
      policy: { warnRatio: 0.7 },
    });
    expect(Number(updated.max_cost_usd)).toBe(10);
    expect(Number(updated.warn_ratio)).toBe(0.7);
    expect(updated.routing_policy).toBe('free_then_paid');

    const routed = await HarnessBudgetService.upsertPolicy({
      projectId,
      policy: { routingPolicy: 'free_only' },
    });
    expect(Number(routed.max_cost_usd)).toBe(10);
    expect(Number(routed.warn_ratio)).toBe(0.7);
    expect(routed.routing_policy).toBe('free_only');

    const withPaid = await HarnessBudgetService.upsertPolicy({
      projectId,
      policy: { paidModel: 'gpt-4o' },
    });
    expect(withPaid.paid_model).toBe('gpt-4o');

    const cleared = await HarnessBudgetService.upsertPolicy({
      projectId,
      policy: { paidModel: null },
    });
    expect(cleared.paid_model).toBeNull();
    expect(Number(cleared.max_cost_usd)).toBe(10);
  });
});
