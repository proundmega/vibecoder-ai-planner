'use strict';

const logger = require('../../utils/logger');
const { positiveInt } = require('./shared');

/**
 * Release claims whose ticket lock expired while no run lease is active.
 *
 * <p>{@code harness_leases} is the only run-lease authority (fg-33). A ticket
 * with an unexpired lease is never released here; the lease reaper owns it.</p>
 */
async function staleClaimSweep(pool, options = {}) {
  const staleMinutes = positiveInt(options.staleMinutes ?? process.env.MANAGER_STALE_CLAIM_MINUTES, 60);
  const batchSize = positiveInt(options.batchSize ?? process.env.MANAGER_BATCH_SIZE, 100);

  const result = await pool.query(
    `WITH stale AS (
       SELECT t.id
         FROM tickets t
        WHERE t.status = 'in_progress'
          AND t.assigned_runtime_id IS NOT NULL
          AND t.locked_at IS NOT NULL
          AND t.locked_at < NOW() - make_interval(mins => $1)
          AND NOT EXISTS (
            SELECT 1 FROM harness_leases l
             WHERE l.ticket_id = t.id
               AND l.expires_at > NOW()
          )
        ORDER BY t.id
        LIMIT $2
          FOR UPDATE SKIP LOCKED
     )
     UPDATE tickets t
        SET assigned_runtime_id = NULL,
            locked_at = NULL,
            status = 'backlog',
            updated_at = NOW()
       FROM stale
      WHERE t.id = stale.id
      RETURNING t.id`,
    [staleMinutes, batchSize]
  );

  if (result.rowCount > 0) {
    logger.info('manager.stale_claim_sweep released', {
      count: result.rowCount,
      staleMinutes,
    });
  }
  return { processed: result.rowCount, released: result.rows.map((row) => row.id) };
}

module.exports = staleClaimSweep;
