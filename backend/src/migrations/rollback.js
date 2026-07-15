require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '.');

function getMigrationFiles() {
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.match(/^\d{3}_.+\.sql$/) && !file.match(/_rollback\.sql$/))
    .sort();
}

function getRollbackFile(migrationFile) {
  const base = migrationFile.replace(/\.sql$/, '');
  return path.join(MIGRATIONS_DIR, `${base}_rollback.sql`);
}

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

async function createMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      version VARCHAR(255) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const result = await pool.query('SELECT version, name FROM _migrations ORDER BY id DESC');
  return result.rows;
}

async function _recordMigration(pool, version, name) {
  await pool.query('INSERT INTO _migrations (version, name) VALUES ($1, $2)', [version, name]);
}

async function removeMigrationRecord(pool, version) {
  await pool.query('DELETE FROM _migrations WHERE version = $1', [version]);
}

async function rollbackLatest() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    family: 4,
  });

  try {
    await pool.query('SELECT NOW()');
    await createMigrationsTable(pool);

    const applied = await getAppliedMigrations(pool);
    if (applied.length === 0) {
      console.log('No migrations to rollback.');
      return;
    }

    const latest = applied[0];
    const migrationFile = getMigrationFiles().find(f => f.startsWith(latest.version));

    if (!migrationFile) {
      console.error(`Migration file not found for version ${latest.version}`);
      process.exit(1);
    }

    const rollbackFile = getRollbackFile(migrationFile);
    if (!fs.existsSync(rollbackFile)) {
      console.error(`Rollback file not found: ${rollbackFile}`);
      process.exit(1);
    }

    const sql = fs.readFileSync(rollbackFile, 'utf8');
    const statements = splitSQLStatements(sql);

    console.log(`\n--- Rolling back ${migrationFile} ---`);

    await pool.query('BEGIN');
    try {
      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        await pool.query(stmt);
        console.log(`  ✓ Statement ${i + 1} executed`);
      }
      await removeMigrationRecord(pool, latest.version);
      await pool.query('COMMIT');
      console.log(`\n✓ Rolled back ${migrationFile} successfully.`);
    } catch (err) {
      await pool.query('ROLLBACK');
      throw err;
    }
  } catch (error) {
    console.error(`Error rolling back ${latest?.version}:`, error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

async function rollbackTo(version) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    family: 4,
  });

  try {
    await pool.query('SELECT NOW()');
    await createMigrationsTable(pool);

    const applied = await getAppliedMigrations(pool);
    const toRollback = applied.filter(m => {
      const num = parseInt(m.version, 10);
      const targetNum = parseInt(version, 10);
      return num > targetNum;
    });

    if (toRollback.length === 0) {
      console.log(`No migrations to rollback (target: ${version}).`);
      return;
    }

    for (const migration of toRollback) {
      const migrationFile = getMigrationFiles().find(f => f.startsWith(migration.version));
      if (!migrationFile) {
        console.error(`Migration file not found for version ${migration.version}`);
        continue;
      }

      const rollbackFile = getRollbackFile(migrationFile);
      if (!fs.existsSync(rollbackFile)) {
        console.error(`Rollback file not found: ${rollbackFile}`);
        continue;
      }

      const sql = fs.readFileSync(rollbackFile, 'utf8');
      const statements = splitSQLStatements(sql);

      console.log(`\n--- Rolling back ${migrationFile} ---`);

      await pool.query('BEGIN');
      try {
        for (let i = 0; i < statements.length; i++) {
          const stmt = statements[i];
          await pool.query(stmt);
          console.log(`  ✓ Statement ${i + 1} executed`);
        }
        await removeMigrationRecord(pool, migration.version);
        await pool.query('COMMIT');
        console.log(`\n✓ Rolled back ${migrationFile} successfully.`);
      } catch (err) {
        await pool.query('ROLLBACK');
        throw err;
      }
    }
  } catch (error) {
    console.error('Error during rollback:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];
  const version = args[1];

  if (command === 'latest') {
    rollbackLatest();
  } else if (command === 'to') {
    rollbackTo(version);
  } else {
    console.log('Usage:');
    console.log('  node rollback latest    - Rollback the latest migration');
    console.log('  node rollback to <ver>  - Rollback to a specific version');
    process.exit(1);
  }
}
