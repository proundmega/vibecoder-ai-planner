const { pool } = require('../db');

function daysEnv(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Bounded retention for fg-54 node credential tables. Expired/revoked
 * enrollment, access and refresh rows are deleted after
 * AGENT_TOKEN_RETENTION_DAYS; node auth events keep a longer window
 * (AGENT_AUTH_EVENT_RETENTION_DAYS).
 */
class AgentTokenCleanupService {
  async purgeExpired({ now = new Date() } = {}) {
    const tokenRetentionDays = daysEnv('AGENT_TOKEN_RETENTION_DAYS', 30);
    const eventRetentionDays = daysEnv('AGENT_AUTH_EVENT_RETENTION_DAYS', 180);
    const tokenCutoff = new Date(now.getTime() - tokenRetentionDays * 24 * 60 * 60 * 1000);
    const eventCutoff = new Date(now.getTime() - eventRetentionDays * 24 * 60 * 60 * 1000);

    const enrollment = await pool.query(
      `DELETE FROM agent_node_enrollment_tokens
       WHERE expires_at < $1
          OR (revoked_at IS NOT NULL AND revoked_at < $1)`,
      [tokenCutoff]
    );
    const access = await pool.query(
      `DELETE FROM agent_node_access_tokens
       WHERE expires_at < $1
          OR (revoked_at IS NOT NULL AND revoked_at < $1)`,
      [tokenCutoff]
    );
    const refresh = await pool.query(
      `DELETE FROM agent_node_refresh_tokens
       WHERE expires_at < $1
          OR (revoked_at IS NOT NULL AND revoked_at < $1)`,
      [tokenCutoff]
    );
    // Replay rows are short-lived (default 60 s) and independent of the token
    // retention window.
    const replays = await pool.query('DELETE FROM agent_node_refresh_replays WHERE expires_at < $1', [now]);
    const events = await pool.query(
      'DELETE FROM agent_node_auth_events WHERE created_at < $1',
      [eventCutoff]
    );

    return {
      nodeEnrollmentTokens: enrollment.rowCount || 0,
      nodeAccessTokens: access.rowCount || 0,
      nodeRefreshTokens: refresh.rowCount || 0,
      nodeRefreshReplays: replays.rowCount || 0,
      nodeAuthEvents: events.rowCount || 0,
      tokenRetentionDays,
      eventRetentionDays,
    };
  }
}

module.exports = new AgentTokenCleanupService();
module.exports.AgentTokenCleanupService = AgentTokenCleanupService;
