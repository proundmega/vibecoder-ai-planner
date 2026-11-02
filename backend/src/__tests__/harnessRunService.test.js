jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

const HarnessRunService = require('../services/HarnessRunService');
const { pool } = require('../db');

const RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('HarnessRunService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('startRun', () => {
    it('persists a run with normalised ids', async () => {
      const row = { id: RUN_ID, ticket_id: 42, agent_id: 7, status: 'running' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await HarnessRunService.startRun({
        ticketId: '42',
        agentId: 7,
        branch: ' feat/fg-33 ',
        baseSha: 'abc123',
        provider: 'anthropic',
        model: 'claude',
      });

      expect(result).toEqual(row);
      expect(pool.query.mock.calls[0][0]).toContain('INSERT INTO harness_runs');
      expect(pool.query.mock.calls[0][1]).toEqual([
        42,
        7,
        'feat/fg-33',
        'abc123',
        null,
        null,
        'anthropic',
        'claude',
        1,
      ]);
    });

    it('rejects a missing ticket id', async () => {
      await expect(
        HarnessRunService.startRun({ agentId: 7, branch: 'b' })
      ).rejects.toThrow('ticketId must be a positive integer');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects a blank branch', async () => {
      await expect(
        HarnessRunService.startRun({ ticketId: 1, agentId: 7, branch: '  ' })
      ).rejects.toThrow('branch is required');
    });

    it('rejects a non-positive attempt', async () => {
      await expect(
        HarnessRunService.startRun({ ticketId: 1, agentId: 7, branch: 'b', attempt: 0 })
      ).rejects.toThrow('attempt must be a positive integer');
    });

    it('requires the ticket to be assigned to the agent owner', async () => {
      await expect(
        HarnessRunService.startRun({ ticketId: 42, agentId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket is not assigned to this agent');
      expect(pool.query.mock.calls[0][0]).toContain('t.assigned_agent_id = a.owner_id');
    });

    it('maps the active-run unique index to a conflict', async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      pool.query.mockRejectedValueOnce(error);

      await expect(
        HarnessRunService.startRun({ ticketId: 42, agentId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket already has an active harness run');
    });
  });

  describe('getRun and queries', () => {
    it('rejects a malformed run id before querying', async () => {
      await expect(HarnessRunService.getRun('not-a-uuid')).rejects.toThrow(
        'runId must be a UUID'
      );
      expect(pool.query).not.toHaveBeenCalled();
    });
    it('returns a run by id', async () => {
      const row = { id: RUN_ID };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(HarnessRunService.getRun(RUN_ID)).resolves.toEqual(row);
    });

    it('throws NotFound for an unknown run', async () => {
      await expect(HarnessRunService.getRun(RUN_ID)).rejects.toThrow('Harness run not found');
    });

    it('returns null when a ticket has no run', async () => {
      await expect(HarnessRunService.getLatestRunForTicket(42)).resolves.toBeNull();
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ticket_id = $1'),
        [42]
      );
    });

    it('lists only running runs for an agent', async () => {
      const rows = [{ id: RUN_ID, status: 'running' }];
      pool.query.mockResolvedValueOnce({ rows });

      await expect(HarnessRunService.listActiveRunsForAgent(7)).resolves.toEqual(rows);
      expect(pool.query.mock.calls[0][0]).toContain("status = 'running'");
    });

    it('lists checkpoints in creation order', async () => {
      const rows = [{ step: 'created' }, { step: 'cloned' }];
      pool.query.mockResolvedValueOnce({ rows });

      await expect(HarnessRunService.getCheckpoints(RUN_ID)).resolves.toEqual(rows);
      expect(pool.query.mock.calls[0][0]).toContain('ORDER BY created_at ASC');
    });
  });

  describe('recordCheckpoint', () => {
    it('updates the run step and inserts the checkpoint in one statement', async () => {
      const row = { id: 'cp-1', run_id: RUN_ID, step: 'prompting' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await HarnessRunService.recordCheckpoint(RUN_ID, 'prompting', {
        files: ['a.js'],
      });

      expect(result).toEqual(row);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('UPDATE harness_runs');
      expect(sql).toContain('INSERT INTO harness_checkpoints');
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain('array_position');
      expect(params).toEqual([
        RUN_ID,
        'prompting',
        '{"files":["a.js"]}',
        HarnessRunService.HARNESS_STEPS,
      ]);
    });

    it('defaults the payload to an empty object', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'cp-1' }] });

      await HarnessRunService.recordCheckpoint(RUN_ID, 'cloned');

      expect(pool.query.mock.calls[0][1][2]).toBe('{}');
    });

    it('rejects a non-object payload', async () => {
      await expect(
        HarnessRunService.recordCheckpoint(RUN_ID, 'cloned', ['nope'])
      ).rejects.toThrow('payload must be a JSON object');
    });

    it('throws when the run is no longer active', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: 'failed' }] });

      await expect(
        HarnessRunService.recordCheckpoint(RUN_ID, 'cloned')
      ).rejects.toThrow('Active harness run not found');
    });

    it('rejects a backwards transition', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: 'running', step: 'verifying' }] });

      await expect(
        HarnessRunService.recordCheckpoint(RUN_ID, 'prompting')
      ).rejects.toThrow('would move the run backwards');
    });

    it('rejects an unknown step', async () => {
      await expect(
        HarnessRunService.recordCheckpoint(RUN_ID, 'reaped')
      ).rejects.toThrow('step must be one of');
      expect(pool.query).not.toHaveBeenCalled();
    });
  });

  describe('heartbeat', () => {
    it('updates heartbeat and optional step for the owning agent', async () => {
      const row = { id: RUN_ID, step: 'verifying' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(
        HarnessRunService.heartbeat(RUN_ID, 7, 'verifying')
      ).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('heartbeat_at = NOW()');
      expect(sql).toContain('agent_step = COALESCE');
      expect(sql).not.toContain('step = COALESCE($3, step)');
      expect(sql).toContain('agent_id = $2');
      expect(params).toEqual([RUN_ID, 7, 'verifying']);
    });

    it('leaves the step untouched when omitted', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: RUN_ID }] });

      await HarnessRunService.heartbeat(RUN_ID, 7);

      expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, 7, null]);
    });

    it('throws when no active run matches the agent', async () => {
      await expect(HarnessRunService.heartbeat(RUN_ID, 7)).rejects.toThrow(
        'Active harness run not found'
      );
    });
  });

  describe('finishRun', () => {
    it('marks a running run terminal and releases its lease', async () => {
      const row = { id: RUN_ID, status: 'succeeded' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      const result = await HarnessRunService.finishRun(RUN_ID, {
        status: 'succeeded',
        headSha: 'def456',
        prUrl: 'https://github.com/o/r/pull/1',
      });

      expect(result).toEqual(row);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("FROM finished");
      expect(sql).toContain('DELETE FROM harness_leases');
      expect(params).toEqual([
        RUN_ID,
        'succeeded',
        null,
        'def456',
        'https://github.com/o/r/pull/1',
      ]);
    });

    it('is idempotent for an already terminal run', async () => {
      const existing = { id: RUN_ID, status: 'failed' };
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existing] });

      await expect(
        HarnessRunService.finishRun(RUN_ID, { status: 'failed', error: 'boom' })
      ).resolves.toEqual(existing);
    });

    it('rejects an unknown terminal status', async () => {
      await expect(
        HarnessRunService.finishRun(RUN_ID, { status: 'done' })
      ).rejects.toThrow('status must be one of');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when the run exists but is still running somehow', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: 'running' }] });

      await expect(
        HarnessRunService.finishRun(RUN_ID, { status: 'failed' })
      ).rejects.toThrow('Harness run is not active');
    });
  });

  describe('leases', () => {
    it('claims a lease only for a running run that owns the ticket', async () => {
      const lease = { ticket_id: 42, run_id: RUN_ID, agent_id: 7 };
      pool.query.mockResolvedValueOnce({ rows: [lease] });

      await expect(
        HarnessRunService.claimLease({
          ticketId: 42,
          runId: RUN_ID,
          agentId: 7,
          ttlSeconds: 120,
        })
      ).resolves.toEqual(lease);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (ticket_id) DO UPDATE');
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('t.assigned_agent_id = a.owner_id');
      expect(params).toEqual([42, RUN_ID, 7, 120]);
    });

    it('returns null when another run holds an unexpired lease', async () => {
      await expect(
        HarnessRunService.claimLease({ ticketId: 42, runId: RUN_ID, agentId: 7 })
      ).resolves.toBeNull();
    });

    it('rejects an out-of-range lease ttl', async () => {
      await expect(
        HarnessRunService.claimLease({
          ticketId: 42,
          runId: RUN_ID,
          agentId: 7,
          ttlSeconds: 0,
        })
      ).rejects.toThrow('ttlSeconds must be an integer between 1 and 86400');
    });

    it('renews an unexpired lease', async () => {
      const lease = { ticket_id: 42, run_id: RUN_ID };
      pool.query.mockResolvedValueOnce({ rows: [lease] });

      await expect(
        HarnessRunService.renewLease({ ticketId: 42, runId: RUN_ID, agentId: 7 })
      ).resolves.toEqual(lease);
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain('expires_at > NOW()');
      expect(sql).toContain("r.status = 'running'");
      expect(sql).toContain('t.assigned_agent_id = a.owner_id');
    });

    it('returns null when renewing a lost lease', async () => {
      await expect(
        HarnessRunService.renewLease({ ticketId: 42, runId: RUN_ID, agentId: 7 })
      ).resolves.toBeNull();
    });

    it('reports whether a lease was released', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ticket_id: 42 }] });
      await expect(HarnessRunService.releaseLease(42, RUN_ID)).resolves.toBe(true);

      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(HarnessRunService.releaseLease(42, RUN_ID)).resolves.toBe(false);
    });

    it('reaps expired leases with SKIP LOCKED and fails their runs', async () => {
      const rows = [{ ticket_id: 42, run_id: RUN_ID, agent_id: 7, run_failed: true }];
      pool.query.mockResolvedValueOnce({ rows });

      await expect(HarnessRunService.reapExpiredLeases(10)).resolves.toEqual(rows);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain("status = 'failed'");
      expect(sql).toContain('run has no lease and heartbeat is stale');
      expect(params).toEqual([10, 900]);
    });

    it('rejects an out-of-range reaper limit', async () => {
      await expect(HarnessRunService.reapExpiredLeases(0)).rejects.toThrow(
        'limit must be an integer between 1 and 1000'
      );
    });
  });
});
