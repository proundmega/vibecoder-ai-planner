const logger = require('./logger');

const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS) || 30000;

let isShuttingDown = false;

async function gracefulShutdown(server, pool) {
  async function shutdown(signal) {
    if (isShuttingDown) {
      logger.info('Shutdown already in progress, ignoring duplicate signal');
      return;
    }

    isShuttingDown = true;
    logger.info(`${signal} received. Starting graceful shutdown...`);

    try {
      if (server) {
        logger.info('Stopping HTTP server...');
        server.close();
      }

      if (pool) {
        logger.info('Closing database pool...');
        await pool.end();
        logger.info('Database pool closed.');
      }

      logger.info('Shutdown complete.');
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

  setTimeout(forceShutdown, SHUTDOWN_TIMEOUT_MS);
}

function resetShutdownState() {
  isShuttingDown = false;
}

module.exports = { gracefulShutdown, isShuttingDown, resetShutdownState };
