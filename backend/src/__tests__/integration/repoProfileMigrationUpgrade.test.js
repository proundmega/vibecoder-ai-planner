const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const schema = `migration_upgrade_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const migration = fs.readFileSync(
  path.join(__dirname, '../../migrations/050_repo_profiles.sql'),
  'utf8'
);

describe('repo profile migration upgrade path', () => {
  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });

  test('adds profile_hash before the index that references it', async () => {
    const client = await pool.connect();
    try {
      await client.query(`CREATE SCHEMA ${schema}`);
      await client.query(`SET search_path TO ${schema}`);

      // Minimal shape of the earlier 1ef01f7 draft: no profile_hash columns.
      await client.query(`
        CREATE TABLE repo_profiles (
          id UUID PRIMARY KEY,
          project_id BIGINT,
          version INTEGER,
          profile JSONB,
          status TEXT,
          created_at TIMESTAMPTZ
        );
        CREATE TABLE repo_profile_validations (
          id UUID PRIMARY KEY,
          project_id BIGINT,
          profile_id UUID,
          profile_version INTEGER,
          profile JSONB,
          status TEXT,
          created_at TIMESTAMPTZ
        );
        CREATE TABLE harness_runs (id UUID PRIMARY KEY);
      `);

      await client.query(migration);

      const columns = await client.query(
        `SELECT table_name, column_name
         FROM information_schema.columns
         WHERE table_schema = $1
           AND table_name IN ('repo_profiles', 'repo_profile_validations')
           AND column_name = 'profile_hash'
         ORDER BY table_name`,
        [schema]
      );
      expect(columns.rows).toEqual([
        { table_name: 'repo_profile_validations', column_name: 'profile_hash' },
        { table_name: 'repo_profiles', column_name: 'profile_hash' },
      ]);

      const indexes = await client.query(
        `SELECT indexname FROM pg_indexes
         WHERE schemaname = $1
           AND indexname IN (
             'idx_repo_profile_validations_profile_hash',
             'uq_repo_profile_validations_pending'
           )
         ORDER BY indexname`,
        [schema]
      );
      expect(indexes.rows.map((row) => row.indexname)).toEqual([
        'idx_repo_profile_validations_profile_hash',
        'uq_repo_profile_validations_pending',
      ]);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => {});
      client.release();
    }
  });
});
