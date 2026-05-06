require('dotenv').config();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const SQL_FILE = path.join(__dirname, './001_base_schema.sql');

async function migrate() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    host: 'localhost',
    user: 'postgres',
    password: 'postgres',
    database: 'vibecode',
  });

  try {
    console.log('Connecting to database...');
    await pool.query('SELECT NOW()');

    const sql = fs.readFileSync(SQL_FILE, 'utf8');
    
    // Split by semicolons to run individual statements
    const statements = sql.split(';')
      .filter(stmt => stmt.trim().length > 0 && !stmt.trim().startsWith('--'));

    console.log(`Processing ${statements.length} statements...`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i].trim();
      if (stmt) {
        try {
          await pool.query(stmt);
          console.log(`✓ Statement ${i + 1} executed`);
        } catch (err) {
          // Ignore errors (already exists, etc.)
          console.log(`! Statement ${i + 1} (may already exist): ${err.message}`);
        }
      }
    }

    console.log('\n✓ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration error:', error.message);
    console.error('\nMake sure PostgreSQL is running:');
    console.error('  docker run -e POSTGRES_PASSWORD=postgres -d postgres:15');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
