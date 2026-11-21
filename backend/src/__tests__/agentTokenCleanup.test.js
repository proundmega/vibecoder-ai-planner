const AgentTokenCleanupService = require('../services/AgentTokenCleanupService');
const { pool } = require('../db');

jest.mock('../db', () => ({
  pool: { query: jest.fn() },
}));

describe('AgentTokenCleanupService (NFR7)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rowCount: 0, rows: [] });
  });

  it('purges node token rows past the retention window and keeps audit rows longer', async () => {
    const now = new Date('2026-06-01T00:00:00Z');
    process.env.AGENT_TOKEN_RETENTION_DAYS = '30';
    process.env.AGENT_AUTH_EVENT_RETENTION_DAYS = '180';

    const result = await AgentTokenCleanupService.purgeExpired({ now });

    expect(result.tokenRetentionDays).toBe(30);
    expect(result.eventRetentionDays).toBe(180);

    const queries = pool.query.mock.calls.map(([sql]) => sql);
    expect(queries).toHaveLength(5);
    expect(queries[0]).toContain('agent_node_enrollment_tokens');
    expect(queries[1]).toContain('agent_node_access_tokens');
    expect(queries[2]).toContain('agent_node_refresh_tokens');
    expect(queries[3]).toContain('agent_node_refresh_replays');
    expect(queries[4]).toContain('agent_node_auth_events');
    // The clean cut dropped these legacy tables.
    for (const legacy of [
      'agent_enrollment_tokens',
      'agent_access_tokens',
      'agent_refresh_tokens',
      'agent_refresh_replays',
      'agent_auth_events',
    ]) {
      expect(queries.join('\n')).not.toMatch(new RegExp(`\\b${legacy}\\b`));
    }

    const tokenCall = pool.query.mock.calls[0];
    const replayCall = pool.query.mock.calls[3];
    const eventCall = pool.query.mock.calls[4];
    expect(tokenCall[1][0].toISOString()).toBe('2026-05-02T00:00:00.000Z');
    expect(replayCall[1][0]).toEqual(now);
    expect(eventCall[1][0].toISOString()).toBe('2025-12-03T00:00:00.000Z');
  });
});
