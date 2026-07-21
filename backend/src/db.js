require('dotenv').config();
const { Pool } = require('pg');
const logger = require('./utils/logger');
const { createGauge } = require('./metrics');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.DATABASE_URL_LOCAL,
  max: parseInt(process.env.DATABASE_POOL_MAX) || 20,
  idleTimeoutMillis: parseInt(process.env.DATABASE_IDLE_TIMEOUT_MS) || 30000,
  connectionTimeoutMillis: parseInt(process.env.DATABASE_CONNECTION_TIMEOUT_MS) || 5000,
  maxUses: parseInt(process.env.DATABASE_MAX_USES) || 10000,
});

pool.on('error', (err, _pgClient) => {
  logger.error('Unexpected error on idle client', err);
  process.exit(-1);
});

pool.stats = () => ({
  totalCount: pool.totalCount,
  idleCount: pool.idleCount,
  waitingCount: pool.waitingCount || 0,
});

// Test connection
async function connect() {
  const client = await pool.connect();
  await client.release();
  return true;
}

// Transaction helper
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// DB pool prometheus gauges
const dbPoolTotal = createGauge('db_pool_total', 'Total connections in the pool');
const dbPoolIdle = createGauge('db_pool_idle', 'Idle connections in the pool');
const dbPoolWaiting = createGauge('db_pool_waiting', 'Waiting clients requesting a connection');

function updatePoolMetrics() {
  dbPoolTotal.set(pool.totalCount || 0);
  dbPoolIdle.set(pool.idleCount || 0);
  dbPoolWaiting.set(pool.waitingCount || 0);
}

module.exports = { pool, connect, transaction, updatePoolMetrics };
