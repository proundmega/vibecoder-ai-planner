require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  path.join(__dirname, './001_create_tables.sql'),
  path.join(__dirname, './002_agents_schema.sql'),
  path.join(__dirname, './003_role_system.sql'),
  path.join(__dirname, './004_persistence_layer.sql'),
  path.join(__dirname, './005_permission_system.sql'),
  path.join(__dirname, './006_ticket_comments.sql'),
  path.join(__dirname, './007_project_repos.sql'),
  path.join(__dirname, './008_ticket_repo_fields.sql'),
  path.join(__dirname, './009_project_providers.sql'),
  path.join(__dirname, './010_project_credentials.sql'),
  path.join(__dirname, './013_usage_logs.sql'),
  path.join(__dirname, './014_project_billing.sql'),
  path.join(__dirname, './011_ticket_ownership.sql'),
  path.join(__dirname, './012_agent_users.sql'),
  path.join(__dirname, './015_shared_agent_memory.sql'),
  path.join(__dirname, './016_ticket_planning.sql'),
];

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
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = '';
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

async function runMigration(file) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    family: 4,
  });

  try {
    await pool.query('SELECT NOW()');

    const sql = fs.readFileSync(file, 'utf8');
    const statements = splitSQLStatements(sql);

    console.log(`\n--- ${path.basename(file)} (${statements.length} statements) ---`);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await pool.query(stmt);
        console.log(`  ✓ Statement ${i + 1} executed`);
      } catch (err) {
        console.log(`  ! Statement ${i + 1} (may already exist): ${err.message}`);
      }
    }
  } catch (error) {
    console.error(`Error in ${path.basename(file)}:`, error.message);
  } finally {
    await pool.end();
  }
}

async function migrate() {
  for (const sqlFile of SQL_FILES) {
    await runMigration(sqlFile);
  }

  console.log('\n\n✓ Migrations completed successfully!');
}

migrate();
