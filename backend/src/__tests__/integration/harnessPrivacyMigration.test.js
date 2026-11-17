const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const FORWARD_SQL = path.join(__dirname, '../../migrations/053_harness_privacy.sql');
const ROLLBACK_SQL = path.join(__dirname, '../../migrations/053_harness_privacy_rollback.sql');
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

describe('Migration 053 harness privacy (real DB, transactional)', () => {
  let client;
  let schema;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    client = await pool.connect();
    schema = `harness_privacy_test_${suffix}`;
  });

  afterAll(async () => {
    if (client) client.release();
    await pool.end();
  });

  test('applies policy constraints and rolls back', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET LOCAL search_path TO ${schema}, public`);
      await client.query('CREATE TABLE users (id BIGINT PRIMARY KEY)');
      await client.query('CREATE TABLE projects (id BIGINT PRIMARY KEY)');
      await client.query('INSERT INTO users (id) VALUES (1)');
      await client.query('INSERT INTO projects (id) VALUES (7)');

      await client.query(fs.readFileSync(FORWARD_SQL, 'utf8'));

      const table = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'harness_privacy_policies'`,
        [schema]
      );
      expect(table.rows).toHaveLength(1);

      await client.query(
        `INSERT INTO harness_privacy_policies
           (project_id, max_data_class, allowed_providers, local_only,
            event_retention_days, artifact_retention_days)
         VALUES (7, 'confidential', ARRAY['opencode-go'], FALSE, 14, 7)`
      );
      const row = await client.query(
        'SELECT max_data_class, allowed_providers FROM harness_privacy_policies WHERE project_id = 7'
      );
      expect(row.rows[0].max_data_class).toBe('confidential');
      expect(row.rows[0].allowed_providers).toEqual(['opencode-go']);

      await client.query('SAVEPOINT bad_class');
      await expect(client.query(
        `INSERT INTO harness_privacy_policies (project_id, max_data_class)
         VALUES (8, 'top-secret')`
      )).rejects.toThrow(/check constraint/);
      await client.query('ROLLBACK TO SAVEPOINT bad_class');

      await client.query(fs.readFileSync(ROLLBACK_SQL, 'utf8'));
      const after = await client.query(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_name = 'harness_privacy_policies'`,
        [schema]
      );
      expect(after.rows).toHaveLength(0);
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
