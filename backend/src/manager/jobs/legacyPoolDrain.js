'use strict';

const logger = require('../../utils/logger');

/**
 * Legacy pool drain. After the fg-54 clean cut there is no `agents` table and
 * this is intentionally a no-op; before the cut it revokes stale pool-owned
 * agent rows so a mixed deployment stops creating new work for them.
 */
async function legacyPoolDrain(pool) {
  const exists = await pool.query("SELECT to_regclass('public.agents') AS table_name");
  if (!exists.rows[0] || !exists.rows[0].table_name) {
    return { processed: 0, skipped: 'legacy agents table is not present' };
  }

  const result = await pool.query(
    `UPDATE agents
        SET api_key = NULL,
            api_key_hash = NULL,
            api_key_hash_prefix = NULL,
            api_key_expires_at = NOW(),
            updated_at = NOW()
      WHERE (api_key IS NOT NULL OR api_key_hash IS NOT NULL)
        AND name LIKE 'agent-%'
        AND NOT EXISTS (
          SELECT 1 FROM agent_nodes n WHERE n.name = agents.name
        )
      RETURNING id`
  );

  if (result.rowCount > 0) {
    logger.info('manager.legacy_pool_drain revoked legacy pool agents', { count: result.rowCount });
  }
  return { processed: result.rowCount, drained: result.rows.map((row) => row.id) };
}

module.exports = legacyPoolDrain;
