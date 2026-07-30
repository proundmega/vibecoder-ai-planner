const { pool } = require('../db');
const logger = require('../utils/logger');

class CspViolationCleanupService {
  async cleanup() {
    const result = await pool.query(
      "DELETE FROM csp_violations WHERE created_at < NOW() - INTERVAL '30 days'"
    );
    if (result.rowCount > 0) {
      logger.info(`CSP violation cleanup: deleted ${result.rowCount} violations older than 30 days`);
    }
  }
}

module.exports = new CspViolationCleanupService();
