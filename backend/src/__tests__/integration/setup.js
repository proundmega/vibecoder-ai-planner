require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { runMigrationFile } = require('./migrationSupport');

const MIGRATION_DIR = path.join(__dirname, '../../migrations');
const SQL_FILES = require('fs')
  .readdirSync(MIGRATION_DIR)
  .filter(f => f.match(/^\d{3}_.+\.sql$/) && !f.endsWith('_rollback.sql'))
  .sort()
  .map(f => path.join(MIGRATION_DIR, f));

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

beforeAll(async () => {
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
