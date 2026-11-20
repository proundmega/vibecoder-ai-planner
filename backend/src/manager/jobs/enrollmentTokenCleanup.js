'use strict';

const logger = require('../../utils/logger');
const { positiveInt } = require('./shared');

/**
 * Purge expired/revoked node join tokens after the retention window. The
 * clean-cut migration may not have run yet (track A owns it), so a missing
 * table is a benign no-op.
 */
async function enrollmentTokenCleanup(pool, options = {}) {
  const retentionDays = positiveInt(options.retentionDays ?? process.env.MANAGER_TOKEN_RETENTION_DAYS, 30);
  const batchSize = positiveInt(options.batchSize ?? process.env.MANAGER_BATCH_SIZE, 100);

  const exists = await pool.query(
    "SELECT to_regclass('public.agent_node_enrollment_tokens') AS table_name"
  );
  if (!exists.rows[0] || !exists.rows[0].table_name) {
    return { processed: 0, skipped: 'agent_node_enrollment_tokens is not present yet' };
  }

  const result = await pool.query(
    `DELETE FROM agent_node_enrollment_tokens
      WHERE id IN (
        SELECT id
          FROM agent_node_enrollment_tokens
         WHERE (expires_at < NOW() - make_interval(days => $1))
            OR (revoked_at IS NOT NULL
                AND revoked_at < NOW() - make_interval(days => $1))
         ORDER BY id
         LIMIT $2
           FOR UPDATE SKIP LOCKED
      )
      RETURNING id`,
    [retentionDays, batchSize]
  );

  if (result.rowCount > 0) {
    logger.info('manager.enrollment_token_cleanup purged', { count: result.rowCount });
  }
  return { processed: result.rowCount, purged: result.rows.map((row) => row.id) };
}

module.exports = enrollmentTokenCleanup;
