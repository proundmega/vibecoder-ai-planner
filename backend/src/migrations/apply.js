require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SQL_FILES = [
  path.join(__dirname, './001_base_schema.sql'),
  path.join(__dirname, './002_agents_schema.sql')
];

async function runMigration(file) {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: 'localhost',
    user: 'postgres',
    password: 'postgres',
    database: 'vibecode',
  });

  try {
    await pool.query('SELECT NOW()');

    const sql = fs.readFileSync(file, 'utf8');
    const statements = sql.split(';')
      .filter(stmt => stmt.trim().length > 0 && !stmt.trim().startsWith('--'));

    console.log(`\n--- ${path.basename(file)} (${statements.length} statements) ---`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (stmt) {
        try {
          await pool.query(stmt);
          console.log(`  ✓ Statement ${i + 1} executed`);
        } catch (err) {
          console.log(`  ! Statement ${i + 1} (may already exist): ${err.message}`);
        }
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
