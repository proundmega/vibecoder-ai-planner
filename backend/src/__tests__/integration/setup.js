require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  path.join(__dirname, '../../migrations/001_create_tables.sql'),
  path.join(__dirname, '../../migrations/002_agents_schema.sql'),
];

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

function splitSQLStatements(sql) {
  const statements = [];
  let current = '';
  let inSingleQuote = false;
  let inDollarQuote = false;
  let dollarTag = '';

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const remaining = sql.slice(i);

    if (inDollarQuote) {
      if (remaining.startsWith(dollarTag)) {
        current += dollarTag;
        i += dollarTag.length - 1;
        inDollarQuote = false;
        dollarTag = '';
      } else {
        current += char;
      }
      continue;
    }

    if (remaining.startsWith('$$')) {
      inDollarQuote = true;
      dollarTag = '$$';
      current += '$$';
      i += 1;
      continue;
    }

    const dollarMatch = remaining.match(/^\$[a-zA-Z_]\w*\$/);
    if (dollarMatch) {
      inDollarQuote = true;
      dollarTag = dollarMatch[0];
      current += dollarTag;
      i += dollarTag.length - 1;
      continue;
    }

    if (char === "'" && (i === 0 || sql[i - 1] !== '\\')) {
      inSingleQuote = !inSingleQuote;
    }

    if (char === ';' && !inSingleQuote && !inDollarQuote) {
      const trimmed = current.trim();
      if (trimmed.length > 0) statements.push(trimmed);
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) statements.push(trimmed);
  return statements;
}

async function runMigration(file) {
  const migrationPool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  try {
    await migrationPool.query('SELECT NOW()');
    const sql = fs.readFileSync(file, 'utf8');
    const statements = splitSQLStatements(sql);

    for (const stmt of statements) {
      try {
        await migrationPool.query(stmt);
      } catch (err) {
        if (!err.message.includes('already exists') && !err.message.includes('duplicate key')) {
          console.warn(`  ! ${err.message}`);
        }
      }
    }
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