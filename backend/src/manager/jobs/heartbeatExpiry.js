'use strict';

const logger = require('../../utils/logger');
const { positiveInt } = require('./shared');

/**
 * Mark runtimes whose heartbeat is stale as stopped. Node rows keep their
 * lifecycle status (active/draining/revoked); {@code last_seen_at} is the
 * liveness signal and is exposed by the fleet API.
 */
async function heartbeatExpiry(pool, options = {}) {
  const staleSeconds = positiveInt(options.staleSeconds ?? process.env.MANAGER_HEARTBEAT_STALE_SECONDS, 120);

  const runtimes = await pool.query(
    `UPDATE agent_runtimes
        SET status = 'stopped',
            updated_at = NOW()
      WHERE status IN ('running', 'draining')
        AND (last_seen_at IS NULL
             OR last_seen_at < NOW() - make_interval(secs => $1))
      RETURNING id`,
    [staleSeconds]
  );

  const nodes = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM agent_nodes
      WHERE status = 'active'
        AND (last_seen_at IS NULL
             OR last_seen_at < NOW() - make_interval(secs => $1))`,
    [staleSeconds]
  );

  if (runtimes.rowCount > 0) {
    logger.info('manager.heartbeat_expiry stopped runtimes', { count: runtimes.rowCount });
  }
  return {
    processed: runtimes.rowCount,
    stoppedRuntimes: runtimes.rows.map((row) => row.id),
    staleNodes: nodes.rows[0] ? nodes.rows[0].count : 0,
  };
}

module.exports = heartbeatExpiry;
