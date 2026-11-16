const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const FORWARD_SQL = path.join(__dirname, '../../migrations/051_harness_events.sql');
const ROLLBACK_SQL = path.join(__dirname, '../../migrations/051_harness_events_rollback.sql');
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Migration 051 harness event store (real DB, transactional)', () => {
  let client;
  let schema;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    client = await pool.connect();
    schema = `harness_events_test_${suffix}`;
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  test('applies, enforces append-only retention and rolls back completely', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query('CREATE TABLE projects (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE tickets (id BIGINT PRIMARY KEY, project_id BIGINT)');
      await client.query('CREATE TABLE agents (id BIGINT PRIMARY KEY)');
      await client.query(
        `CREATE TABLE harness_runs (
           id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
           ticket_id BIGINT,
           agent_id BIGINT,
           started_at TIMESTAMPTZ DEFAULT NOW()
         )`
      );
      await client.query('INSERT INTO projects (id) VALUES (7)');
      await client.query('INSERT INTO tickets (id, project_id) VALUES (42, 7)');
      await client.query('INSERT INTO agents (id) VALUES (9)');
      await client.query(
        'INSERT INTO harness_runs (ticket_id, agent_id) VALUES (42, 9)'
      );

      await client.query(fs.readFileSync(FORWARD_SQL, 'utf8'));

      const backfill = await client.query(
        'SELECT project_id FROM harness_runs LIMIT 1'
      );
      expect(Number(backfill.rows[0].project_id)).toBe(7);

      const projectIndex = await client.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = $1 AND indexname = 'idx_harness_runs_project_started'`,
        [schema]
      );
      expect(projectIndex.rows).toHaveLength(1);

      await client.query(
        `INSERT INTO harness_events
           (event_id, trace_id, run_id, ticket_id, project_id, agent_id, type, payload)
         VALUES
           ('11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
            (SELECT id FROM harness_runs LIMIT 1), 42, 7, 9, 'run.started', '{}'::jsonb)`
      );

      await expect(client.query(
        "UPDATE harness_events SET type = 'tampered'"
      )).rejects.toThrow(/append-only/);
      await expect(client.query('DELETE FROM harness_events'))
        .rejects.toThrow(/retention/);

      await client.query("SET LOCAL harness.allow_event_purge = 'on'");
      const purged = await client.query('DELETE FROM harness_events');
      expect(purged.rowCount).toBe(1);

      await client.query(fs.readFileSync(ROLLBACK_SQL, 'utf8'));

      const table = await client.query('SELECT to_regclass($1) AS name', [
        `${schema}.harness_events`,
      ]);
      expect(table.rows[0].name).toBeNull();

      const column = await client.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = 'harness_runs'
           AND column_name = 'project_id'`,
        [schema]
      );
      expect(column.rows).toHaveLength(0);

      const index = await client.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = $1 AND indexname = 'idx_harness_runs_project_started'`,
        [schema]
      );
      expect(index.rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
