require('dotenv').config();
const { Pool } = require('pg');
const { runMigrationFile } = require('./migrationSupport');

// Only migrations registered in apply.js. 057 is registered by default.
const { SQL_FILES } = require('../../migrations/apply');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration(file) {
  const migrationPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await migrationPool.query('SELECT NOW()');
    await runMigrationFile(file, migrationPool);
  } finally {
    await migrationPool.end();
  }
}

/**
 * A long-lived integration database may already carry the destructive 057
 * cut. Rebuild it so the registered migration chain starts from a clean base.
 */
async function resetIfCleanCutApplied() {
  const columns = await pool.query(
    `SELECT
       to_regclass('public.agent_runtimes') IS NOT NULL AS has_runtimes,
       to_regclass('public.agents') IS NOT NULL AS has_agents`
  );
  const row = columns.rows[0];
  const cutApplied = row.has_runtimes && !row.has_agents;
  if (!cutApplied) return;

  const resetAllowed =
    process.env.NODE_ENV === 'test'
    || process.env.INTEGRATION_TESTS === '1'
    || process.env.ALLOW_TEST_DB_RESET === '1';
  if (!resetAllowed) {
    throw new Error(
      'Refusing to reset a database that carries the fg-54 clean cut; set ALLOW_TEST_DB_RESET=1 for a disposable test database'
    );
  }

  await pool.query('DROP SCHEMA public CASCADE');
  await pool.query('CREATE SCHEMA public');
}

beforeAll(async () => {
  await resetIfCleanCutApplied();
  for (const sqlFile of SQL_FILES) {
    await runMigration(sqlFile);
  }
});

afterAll(async () => {
  await pool.end();
});

global.db = pool;

global.withTransaction = async (fn) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
};
