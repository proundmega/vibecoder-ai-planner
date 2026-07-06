const logger = require('./logger');
const { closeRedis } = require('./redis');

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS) || 30000;

let isShuttingDown = false;

async function gracefulShutdown(server, pool, cleanupHooks = []) {
  async function shutdown(signal) {
    if (isShuttingDown) {
      logger.info('Shutdown already in progress, ignoring duplicate signal');
      return;
    }

    isShuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown...`);

    const forceTimer = setTimeout(forceShutdown, SHUTDOWN_TIMEOUT_MS);

    try {
      for (const hook of cleanupHooks) {
        try {
          await hook();
        } catch (err) {
          logger.error('Error during cleanup hook:', err.message);
        }
      }

      logger.info('Closing Redis connection...');
      await closeRedis();
      logger.info('Redis connection closed.');

      if (server) {
        logger.info('Stopping HTTP server...');
        await new Promise((resolve) => server.close(resolve));
      }

      if (pool) {
        logger.info('Closing database pool...');
        await pool.end();
        logger.info('Database pool closed.');
      }

      logger.info('Shutdown complete.');
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown:', error);
      process.exit(1);
    }
  }

  function forceShutdown() {
    logger.error(`Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) exceeded. Forcing exit.`);
    process.exit(1);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function resetShutdownState() {
  isShuttingDown = false;
}

module.exports = { gracefulShutdown, isShuttingDown, resetShutdownState };
