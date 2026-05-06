require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_LOCAL,
  idle_timeout: 20000,
  connection_timeout: 10000,
});

// Test connection
async function connect() {
  const client = await pool.connect();
  await client.release();
  return true;
}

module.exports = { pool, connect };
