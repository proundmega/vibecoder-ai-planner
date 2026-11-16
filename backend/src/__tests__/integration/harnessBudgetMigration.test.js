const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FORWARD_SQL = path.join(__dirname, '../../migrations/052_harness_budgets.sql');
const ROLLBACK_SQL = path.join(__dirname, '../../migrations/052_harness_budgets_rollback.sql');
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Migration 052 harness budgets (real DB, transactional)', () => {
  let client;
  let schema;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    client = await pool.connect();
    schema = `harness_budgets_test_${suffix}`;
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  test('applies usage/policy/kill-switch constraints and rolls back completely', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE projects (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE tickets (id BIGINT PRIMARY KEY, project_id BIGINT)');
      await client.query('CREATE TABLE agents (id BIGINT PRIMARY KEY)');
      await client.query(
        `CREATE TABLE harness_runs (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           ticket_id BIGINT,
           started_at TIMESTAMPTZ DEFAULT NOW()
         )`
      );
      await client.query(
        `CREATE TABLE usage_logs (
           id BIGSERIAL PRIMARY KEY,
           project_id BIGINT,
           agent_id BIGINT,
           provider_type TEXT,
           model TEXT,
           tokens_in INTEGER DEFAULT 0,
           tokens_out INTEGER DEFAULT 0,
           cost_usd NUMERIC(12,6) DEFAULT 0,
           duration_ms INTEGER DEFAULT 0,
           ticket_id BIGINT,
           request_type TEXT DEFAULT 'chat',
           metadata JSONB DEFAULT '{}'
         )`
      );
      await client.query('INSERT INTO users (id) VALUES (1)');
      await client.query('INSERT INTO projects (id) VALUES (7)');
      await client.query('INSERT INTO tickets (id, project_id) VALUES (42, 7)');
      await client.query('INSERT INTO agents (id) VALUES (9)');

      await client.query(fs.readFileSync(FORWARD_SQL, 'utf8'));

      const tables = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1
           AND table_name IN ('harness_usage','model_prices',
                              'harness_budget_policies','harness_kill_switches')
         ORDER BY table_name`,
        [schema]
      );
      expect(tables.rows.map((row) => row.table_name)).toEqual([
        'harness_budget_policies',
        'harness_kill_switches',
        'harness_usage',
        'model_prices',
      ]);

      await client.query(
        `INSERT INTO usage_logs
           (project_id, agent_id, provider_type, model, request_type, metadata)
         VALUES (7, 9, 'harness', 'gpt-4o', 'harness',
                 '{"run_id":"run-1"}'::jsonb)`
      );
      await client.query('SAVEPOINT duplicate_usage');
      await expect(client.query(
        `INSERT INTO usage_logs
           (project_id, agent_id, provider_type, model, request_type, metadata)
         VALUES (7, 9, 'harness', 'gpt-4o', 'harness',
                 '{"run_id":"run-1"}'::jsonb)`
      )).rejects.toThrow(/duplicate key/);
      await client.query('ROLLBACK TO SAVEPOINT duplicate_usage');

      await client.query(
        `INSERT INTO harness_budget_policies
           (project_id, scope, routing_policy, warn_ratio)
         VALUES (7, 'project', 'free_then_paid', 0.8)`
      );
      await client.query('SAVEPOINT duplicate_policy');
      await expect(client.query(
        `INSERT INTO harness_budget_policies
           (project_id, scope, routing_policy, warn_ratio)
         VALUES (7, 'project', 'free_only', 0.7)`
      )).rejects.toThrow(/duplicate key/);
      await client.query('ROLLBACK TO SAVEPOINT duplicate_policy');

      await client.query(
        `INSERT INTO harness_kill_switches (scope, project_id, enabled)
         VALUES ('project', 7, TRUE)`
      );
      await client.query('SAVEPOINT duplicate_switch');
      await expect(client.query(
        `INSERT INTO harness_kill_switches (scope, project_id, enabled)
         VALUES ('project', 7, FALSE)`
      )).rejects.toThrow(/duplicate key/);
      await client.query('ROLLBACK TO SAVEPOINT duplicate_switch');

      await client.query(fs.readFileSync(ROLLBACK_SQL, 'utf8'));

      const remaining = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1
           AND table_name IN ('harness_usage','model_prices',
                              'harness_budget_policies','harness_kill_switches')`,
        [schema]
      );
      expect(remaining.rows).toHaveLength(0);

      const index = await client.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = $1 AND indexname = 'idx_harness_runs_ticket_started'`,
        [schema]
      );
      expect(index.rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
