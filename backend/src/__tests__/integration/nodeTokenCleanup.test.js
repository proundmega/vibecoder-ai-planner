const { Pool } = require('pg');
const AgentTokenCleanupService = require('../../services/AgentTokenCleanupService');

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let ownerId;

describe('Node token retention after the clean cut (real DB)', () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    const owner = await pool.query(
      `INSERT INTO users (email, name, password_hash, role)
       VALUES ($1, 'Cleanup Owner', 'x', 'user') RETURNING id`,
      [`cleanup_owner_${suffix}@test.com`]
    );
    ownerId = owner.rows[0].id;
  });

  afterAll(async () => {
    if (ownerId) {
      await pool.query('DELETE FROM users WHERE id = $1', [ownerId]);
    }
    await pool.end();
  });

  test('purges expired node credentials and node auth events', async () => {
    const previousTokenDays = process.env.AGENT_TOKEN_RETENTION_DAYS;
    const previousEventDays = process.env.AGENT_AUTH_EVENT_RETENTION_DAYS;
    // The live API also purges at startup with its default 30/180-day windows.
    // Use a shorter local window so the API cannot delete the fixtures before
    // this test's explicit purge call (2 days old is inside the API window).
    process.env.AGENT_TOKEN_RETENTION_DAYS = '1';
    process.env.AGENT_AUTH_EVENT_RETENTION_DAYS = '1';
    try {
      await pool.query(
        `INSERT INTO agent_node_enrollment_tokens
           (owner_id, name, token_prefix, token_hash, expires_at)
         VALUES ($1, 'expired', 'old', $2, NOW() - INTERVAL '2 days')`,
        [ownerId, `old_${suffix}`]
      );
      await pool.query(
        `INSERT INTO agent_node_auth_events (event_type, actor_type, created_at)
         VALUES ('test.cleanup', 'system', NOW() - INTERVAL '2 days')`
      );

      const result = await AgentTokenCleanupService.purgeExpired();

      expect(result.nodeEnrollmentTokens).toBeGreaterThanOrEqual(1);
      expect(result.nodeAuthEvents).toBeGreaterThanOrEqual(1);

      const enrollment = await pool.query(
        'SELECT 1 FROM agent_node_enrollment_tokens WHERE token_hash = $1',
        [`old_${suffix}`]
      );
      expect(enrollment.rows).toHaveLength(0);
      const events = await pool.query(
        "SELECT 1 FROM agent_node_auth_events WHERE event_type = 'test.cleanup'"
      );
      expect(events.rows).toHaveLength(0);
    } finally {
      if (previousTokenDays === undefined) {
        delete process.env.AGENT_TOKEN_RETENTION_DAYS;
      } else {
        process.env.AGENT_TOKEN_RETENTION_DAYS = previousTokenDays;
      }
      if (previousEventDays === undefined) {
        delete process.env.AGENT_AUTH_EVENT_RETENTION_DAYS;
      } else {
        process.env.AGENT_AUTH_EVENT_RETENTION_DAYS = previousEventDays;
      }
    }
  });
});
