'use strict';

/**
 * fg-54 manager job units (FR14, NFR4).
 *
 * The jobs are tested against a fake pg client so the SQL contract and the
 * advisory-lock behavior are asserted without a database. Integration tests
 * cover the real schema in `integration/agentFleet.integration.test.js`.
 */

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
    end: jest.fn(),
  },
}));

const { pool } = require('../db');
const {
  staleClaimSweep,
  enrollmentTokenCleanup,
  heartbeatExpiry,
  legacyPoolDrain,
  JOBS,
} = require('../manager/jobs');
const { runTick, runWithLock } = require('../manager');

function fakeClient(handler) {
  return {
    query: jest.fn(handler),
    release: jest.fn(),
  };
}

describe('fg-54 manager jobs (FR14)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('FR14 stale claim sweep skips tickets with an unexpired harness lease', async () => {
    const client = fakeClient((sql) => {
      if (sql.includes('WITH stale')) {
        return { rowCount: 2, rows: [{ id: 10 }, { id: 11 }] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await staleClaimSweep(client, { staleMinutes: 30, batchSize: 50 });

    expect(result.processed).toBe(2);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain('harness_leases');
    expect(sql).toContain('l.expires_at > NOW()');
    expect(sql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sql).toContain("status = 'backlog'");
    expect(params).toEqual([30, 50]);
  });

  test('FR14 stale claim sweep is idempotent when nothing is stale', async () => {
    const client = fakeClient(() => ({ rowCount: 0, rows: [] }));
    await staleClaimSweep(client);
    const second = await staleClaimSweep(client);
    expect(second.processed).toBe(0);
    expect(second.released).toEqual([]);
  });

  test('FR14 enrollment token cleanup purges only expired or old revoked tokens', async () => {
    const client = fakeClient((sql) => {
      if (sql.includes('to_regclass')) {
        return { rows: [{ table_name: 'agent_node_enrollment_tokens' }] };
      }
      return { rowCount: 1, rows: [{ id: 7 }] };
    });

    const result = await enrollmentTokenCleanup(client, { retentionDays: 30, batchSize: 100 });

    expect(result.processed).toBe(1);
    const [deleteSql, params] = client.query.mock.calls[1];
    expect(deleteSql).toContain('DELETE FROM agent_node_enrollment_tokens');
    expect(deleteSql).toContain('expires_at < NOW()');
    expect(deleteSql).toContain('revoked_at IS NOT NULL');
    expect(deleteSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(params).toEqual([30, 100]);
  });

  test('FR14 enrollment token cleanup is a no-op before the fleet migration', async () => {
    const client = fakeClient(() => ({ rows: [{ table_name: null }] }));
    const result = await enrollmentTokenCleanup(client);
    expect(result.processed).toBe(0);
    expect(result.skipped).toContain('not present');
  });

  test('FR14 heartbeat expiry stops stale runtimes and leaves fresh ones', async () => {
    const client = fakeClient((sql) => {
      if (sql.includes('UPDATE agent_runtimes')) {
        return { rowCount: 1, rows: [{ id: 4 }] };
      }
      if (sql.includes('FROM agent_nodes')) {
        return { rows: [{ count: 2 }] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await heartbeatExpiry(client, { staleSeconds: 120 });

    expect(result.processed).toBe(1);
    expect(result.stoppedRuntimes).toEqual([4]);
    expect(result.staleNodes).toBe(2);
    const [sql, params] = client.query.mock.calls[0];
    expect(sql).toContain("status = 'stopped'");
    expect(sql).toContain('last_seen_at');
    expect(params).toEqual([120]);
  });

  test('FR14 legacy pool drain is a no-op after the clean cut', async () => {
    const client = fakeClient(() => ({ rows: [{ table_name: null }] }));
    const result = await legacyPoolDrain(client);
    expect(result.processed).toBe(0);
    expect(result.skipped).toContain('not present');
  });

  test('FR14 every registered job is idempotent at the unit boundary', async () => {
    expect(JOBS.map((job) => job.name)).toEqual([
      'stale_claim_sweep',
      'enrollment_token_cleanup',
      'heartbeat_expiry',
      'legacy_pool_drain',
    ]);
    for (const job of JOBS) {
      const client = fakeClient((sql) => {
        if (sql.includes('to_regclass')) return { rows: [{ table_name: null }] };
        return { rowCount: 0, rows: [] };
      });
      const first = await job.run(client, {});
      const second = await job.run(client, {});
      expect(first.processed).toBe(0);
      expect(second.processed).toBe(0);
    }
  });
});

describe('fg-54 manager replicas (NFR4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('NFR4 two replicas run one job each (advisory lock winner)', async () => {
    const winner = fakeClient((sql) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      if (sql.includes('WITH stale')) return { rowCount: 1, rows: [{ id: 21 }] };
      if (sql.includes('to_regclass')) return { rows: [{ table_name: null }] };
      if (sql.includes('UPDATE agent_runtimes')) return { rowCount: 0, rows: [] };
      if (sql.includes('FROM agent_nodes')) return { rows: [{ count: 0 }] };
      return { rowCount: 0, rows: [] };
    });
    const loser = fakeClient((sql) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: false }] };
      return { rowCount: 0, rows: [] };
    });
    pool.connect
      .mockResolvedValueOnce(winner)
      .mockResolvedValueOnce(loser);

    const results = await Promise.all([
      runTick({ jobs: ['stale_claim_sweep'] }),
      runTick({ jobs: ['stale_claim_sweep'] }),
    ]);

    const all = results.flat();
    const applied = all.filter((row) => row.processed === 1);
    const skipped = all.filter((row) => String(row.skipped || '').includes('another replica'));
    expect(applied).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(winner.release).toHaveBeenCalled();
    expect(loser.release).toHaveBeenCalled();
    expect(loser.query.mock.calls.some(([sql]) => sql.includes('WITH stale'))).toBe(false);
  });

  test('NFR4 the advisory lock is released when a job throws', async () => {
    const client = fakeClient((sql) => {
      if (sql.includes('pg_try_advisory_lock')) return { rows: [{ acquired: true }] };
      if (sql.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
      throw new Error('boom');
    });
    pool.connect.mockResolvedValueOnce(client);

    await expect(runWithLock('exploding', async () => {
      throw new Error('job failed');
    })).rejects.toThrow('job failed');
    expect(client.query.mock.calls.some(([sql]) => sql.includes('pg_advisory_unlock'))).toBe(true);
    expect(client.release).toHaveBeenCalled();
  });
});
