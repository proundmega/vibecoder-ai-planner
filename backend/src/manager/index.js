'use strict';

require('dotenv').config();

const http = require('http');
const { pool } = require('../db');
const logger = require('../utils/logger');
const { JOBS } = require('./jobs');

const DEFAULT_PORT = 3002;
const DEFAULT_INTERVAL_MS = 30000;

function logValue(value) {
  return typeof value === 'object' ? JSON.stringify(value) : value;
}

function intervalMs() {
  const parsed = parseInt(process.env.MANAGER_JOB_INTERVAL_MS, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_INTERVAL_MS;
}

function managerPort() {
  const parsed = parseInt(process.env.MANAGER_PORT, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

/**
 * Run one job under a Postgres advisory lock.
 *
 * <p>The lock is session-scoped and is released on success, failure, or a
 * dropped connection, so a crashed replica cannot starve the job. Replicas
 * that lose the race skip the tick instead of duplicating the side effect.</p>
 */
async function runWithLock(jobName, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    const lock = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS acquired",
      [`fg54-manager:${jobName}`]
    );
    locked = Boolean(lock.rows[0] && lock.rows[0].acquired);
    if (!locked) {
      return { job: jobName, skipped: 'locked by another replica' };
    }
    const result = await fn(client);
    return { job: jobName, ...result };
  } finally {
    if (locked) {
      try {
        await client.query(
          "SELECT pg_advisory_unlock(hashtext($1)::bigint)",
          [`fg54-manager:${jobName}`]
        );
      } catch (error) {
        logger.warn('manager advisory unlock failed', { job: jobName, error: error.message });
      }
    }
    client.release();
  }
}

async function runTick(options = {}) {
  const results = [];
  for (const job of JOBS) {
    if (options.jobs && !options.jobs.includes(job.name)) continue;
    try {
      const result = await runWithLock(job.name, (client) => job.run(client, options));
      results.push(result);
      logger.info('manager job finished', {
        job: job.name,
        processed: result.processed ?? 0,
        skipped: result.skipped || null,
      });
    } catch (error) {
      logger.error('manager job failed', { job: job.name, error: error.message });
      results.push({ job: job.name, error: error.message });
    }
  }
  return results;
}

function createHealthServer() {
  return http.createServer(async (req, res) => {
    if (req.url !== '/health' && req.url !== '/ready') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'NOT_FOUND' } }));
      return;
    }
    try {
      await pool.query('SELECT 1');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: { status: 'ok' } }));
    } catch {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: { code: 'DB_UNAVAILABLE' } }));
    }
  });
}

async function start() {
  const port = managerPort();
  const tickMs = intervalMs();
  const server = createHealthServer();
  server.listen(port, () => {
    logger.info('manager listening', { port, tickMs });
  });

  let running = false;
  let timer = null;

  const tick = async () => {
    if (running) {
      logger.warn('manager tick still running; skipping overlap');
      return;
    }
    running = true;
    try {
      await runTick();
    } finally {
      running = false;
    }
  };

  // First tick immediately, then a fixed interval. The interval is long enough
  // that the manager is idle between ticks (no busy loop).
  await tick();
  timer = setInterval(tick, tickMs);

  const shutdown = async (signal) => {
    logger.info('manager shutting down', { signal });
    if (timer) clearInterval(timer);
    server.close();
    try {
      await pool.end();
    } catch (error) {
      logger.warn('manager pool shutdown failed', { error: error.message });
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  if (process.argv.includes('--once')) {
    runTick()
      .then((results) => {
        logger.info('manager once complete', { results: logValue(results) });
        return pool.end();
      })
      .then(() => process.exit(0))
      .catch((error) => {
        logger.error('manager once failed', { error: error.message });
        process.exit(1);
      });
  } else {
    start().catch((error) => {
      logger.error('manager failed to start', { error: error.message });
      process.exit(1);
    });
  }
}

module.exports = {
  runTick,
  runWithLock,
  createHealthServer,
  intervalMs,
  managerPort,
};
