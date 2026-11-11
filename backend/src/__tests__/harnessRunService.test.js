jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
  },
}));

jest.mock('../services/DependencyService', () => ({
  assertReady: jest.fn().mockResolvedValue({ ready: true }),
}));

const HarnessRunService = require('../services/HarnessRunService');
const DependencyService = require('../services/DependencyService');
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
      pool.query
        .mockResolvedValueOnce({ rows: [{ status: 'in_progress', assigned_agent_id: '7' }] })
        .mockResolvedValueOnce({ rows: [row] });

      const result = await HarnessRunService.startRun({
        ticketId: '42',
        agentId: 7,
        branch: ' feat/fg-33 ',
        baseSha: 'abc123',
        provider: 'anthropic',
        model: 'claude',
      });

      expect(result).toEqual(row);
      expect(DependencyService.assertReady).toHaveBeenCalledWith(42);
      expect(pool.query.mock.calls[1][0]).toContain('INSERT INTO harness_runs');
      expect(pool.query.mock.calls[1][1]).toEqual([
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

    it('requires the ticket to be assigned to the agent', async () => {
      await expect(
        HarnessRunService.startRun({ ticketId: 42, agentId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket is not assigned to this agent');
      expect(
        pool.query.mock.calls.some(call => String(call[0]).includes('t.assigned_agent_id = a.id'))
      ).toBe(true);
    });

    it('maps the active-run unique index to a conflict', async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      pool.query
        .mockResolvedValueOnce({ rows: [{ status: 'in_progress', assigned_agent_id: '7' }] })
        .mockRejectedValueOnce(error);

      await expect(
        HarnessRunService.startRun({ ticketId: 42, agentId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket already has an active harness run');
    });

    it('refuses a new run when dependencies are not ready', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ status: 'in_progress', assigned_agent_id: '7' }],
      });
      DependencyService.assertReady.mockRejectedValueOnce(
        Object.assign(new Error('Cannot start: 2 dependencies are not done'), {
          code: 'DEPENDENCIES_NOT_DONE',
        })
      );

      await expect(
        HarnessRunService.startRun({ ticketId: 42, agentId: 7, branch: 'b' })
      ).rejects.toThrow('Cannot start: 2 dependencies are not done');
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('does not probe dependencies for a ticket owned by another agent', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ status: 'in_progress', assigned_agent_id: '9' }] })
        .mockResolvedValueOnce({ rows: [] });

      await expect(
        HarnessRunService.startRun({ ticketId: 42, agentId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket is not assigned to this agent');
      expect(DependencyService.assertReady).not.toHaveBeenCalled();
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
      const sql = pool.query.mock.calls[0][0];
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain('last_checkpoint_payload');
      expect(sql).toContain('ticket_status');
      expect(sql).toContain('lease_expires_at');
      expect(sql).toContain('LEFT JOIN LATERAL');
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
      expect(sql).toContain('head_sha = COALESCE');
      expect(sql).toContain('pr_url = COALESCE');
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

    it('normalises blank head sha and PR URL to NULL', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: 'failed' }] });

      await HarnessRunService.finishRun(RUN_ID, {
        status: 'failed',
        headSha: '   ',
        prUrl: '',
      });

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain("NULLIF(BTRIM($4), '')");
      expect(sql).toContain("NULLIF(BTRIM($5), '')");
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
      expect(sql).toContain('t.assigned_agent_id = a.id');
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
      expect(sql).toContain('l.ticket_id = r.ticket_id');
      expect(sql).toContain('l.agent_id = r.agent_id');
      expect(sql).toContain('t.assigned_agent_id = a.id');
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
      expect(sql).toContain("NULLIF(BTRIM(r.pr_url), '') IS NOT NULL THEN 'succeeded'");
      expect(sql).toContain("status = 'failed'");
      expect(sql).toContain('run has no lease and heartbeat is stale');
      expect(params).toEqual([10, 900]);
    });

    it('reconciles a terminal run atomically and marks it', async () => {
      const row = {
        run_id: RUN_ID, ticket_id: 42, adopted: false, released: true, marked: true,
      };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(HarnessRunService.reconcileRun(RUN_ID)).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('adopted AS');
      expect(sql).toContain('released AS');
      expect(sql).toContain('marked AS');
      expect(sql).toContain('superseded AS');
      expect(sql).toContain('reconciled_at = NOW()');
      expect(sql).toContain('reconciled_at IS NULL');
      expect(sql).toContain('is_latest');
      expect(sql).toContain('run.pr_url IS NULL');
      expect(sql).toContain('run.head_sha IS NULL');
      expect(sql).toContain("t.status IN ('in_progress', 'backlog')");
      expect(sql).toContain("t.status <> 'done'");
      expect(params).toEqual([RUN_ID]);
    });

    it('lists terminal runs that still need reconciliation', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: RUN_ID }] });

      await expect(
        HarnessRunService.listTerminalRunsForReconcile(25)
      ).resolves.toEqual([RUN_ID]);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("status <> 'running'");
      expect(sql).toContain('reconciled_at IS NULL');
      expect(sql).toContain('DISTINCT ON (ticket_id)');
      expect(sql).toContain('ORDER BY ticket_id, started_at DESC');
      expect(params).toEqual([25]);
    });

    it('rejects an out-of-range reconcile limit', async () => {
      await expect(
        HarnessRunService.listTerminalRunsForReconcile(0)
      ).rejects.toThrow('limit must be an integer between 1 and 1000');
    });

    it('rejects an out-of-range reaper limit', async () => {
      await expect(HarnessRunService.reapExpiredLeases(0)).rejects.toThrow(
        'limit must be an integer between 1 and 1000'
      );
    });

    it('releases a reaped ticket only through the guarded update', async () => {
      const ticket = { id: 42, status: 'backlog', assigned_agent_id: null };
      pool.query.mockResolvedValueOnce({ rows: [ticket] });

      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID)
      ).resolves.toEqual(ticket);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("r.status = 'failed'");
      expect(sql).toContain("NULLIF(BTRIM(r.pr_url), '') IS NULL");
      expect(sql).toContain("NULLIF(BTRIM(r.head_sha), '') IS NULL");
      expect(sql).toContain("t.status = 'in_progress'");
      expect(sql).toContain("NULLIF(BTRIM(t.pr_url), '') IS NULL");
      expect(sql).toContain('NOT EXISTS');
      expect(params).toEqual([RUN_ID, null]);
    });

    it('allows an operator to release a dead-letter run explicitly', async () => {
      const ticket = { id: 42, status: 'backlog', assigned_agent_id: null };
      pool.query.mockResolvedValueOnce({ rows: [ticket] });

      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID, { allowDeadLetter: true })
      ).resolves.toEqual(ticket);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("r.status IN ('failed', 'dead_letter')");
      expect(params).toEqual([RUN_ID, null]);
    });

    it('scopes an agent-initiated release to its own run', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID, { agentId: 7 })
      ).resolves.toBeNull();
      expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, 7]);
    });
  });

  describe('operator recovery', () => {
    it('dead-letters a run, clears its reconciliation marker and lease', async () => {
      const row = { id: RUN_ID, status: 'dead_letter' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(
        HarnessRunService.deadLetterRun(RUN_ID, { error: 'stuck' })
      ).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("status = 'dead_letter'");
      expect(sql).toContain('reconciled_at = NULL');
      expect(sql).toContain('DELETE FROM harness_leases');
      expect(params).toEqual([RUN_ID, 'stuck']);
    });

    it('refuses to dead-letter a succeeded run', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: 'succeeded' }] });

      await expect(
        HarnessRunService.deadLetterRun(RUN_ID)
      ).rejects.toThrow('Cannot dead-letter a succeeded harness run with publish evidence');
    });

    it('allows dead-lettering a succeeded run with no publish evidence', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: RUN_ID, status: 'dead_letter' }],
      });

      await expect(HarnessRunService.deadLetterRun(RUN_ID)).resolves.toEqual({
        id: RUN_ID, status: 'dead_letter',
      });

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain("status <> 'succeeded'");
      expect(sql).toContain('NULLIF(BTRIM(pr_url), \'\') IS NULL');
    });

    it('adopts a head-only run with an operator-verified PR URL', async () => {
      pool.query
        .mockResolvedValueOnce({
          rows: [{
            id: RUN_ID, status: 'failed', pr_url: null, head_sha: 'abc123',
          }],
        })
        .mockResolvedValueOnce({ rows: [{ id: RUN_ID, pr_url: 'https://example/pull/9' }] })
        .mockResolvedValueOnce({
          rows: [{ run_id: RUN_ID, ticket_id: 42, adopted: true, released: false, marked: true }],
        });

      await expect(
        HarnessRunService.adoptPublishedRun(RUN_ID, {
          prUrl: 'https://example/pull/9',
        })
      ).resolves.toMatchObject({ adopted: true });

      expect(pool.query.mock.calls[1][0]).toContain('SET pr_url = COALESCE($2, pr_url)');
      expect(pool.query.mock.calls[1][1]).toEqual([RUN_ID, 'https://example/pull/9']);
    });

    it('refuses to overwrite an existing run PR with a different operator URL', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{
          id: RUN_ID,
          status: 'failed',
          pr_url: 'https://example/pull/old',
          head_sha: 'abc',
        }],
      });

      await expect(
        HarnessRunService.adoptPublishedRun(RUN_ID, {
          prUrl: 'https://example/pull/new',
        })
      ).rejects.toThrow('refusing to overwrite');
    });

    it('requires an operator PR URL for a head-only run', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: RUN_ID, status: 'failed', pr_url: null, head_sha: 'abc123' }],
      });

      await expect(
        HarnessRunService.adoptPublishedRun(RUN_ID)
      ).rejects.toThrow('provide the operator-verified prUrl');
    });

    it('adopts only a terminal run with publish evidence', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: RUN_ID, status: 'failed', pr_url: null }],
      });
      await expect(
        HarnessRunService.adoptPublishedRun(RUN_ID)
      ).rejects.toThrow('no publish evidence');

      pool.query.mockResolvedValueOnce({
        rows: [{ id: RUN_ID, status: 'running', pr_url: 'https://example/pull/1' }],
      });
      await expect(
        HarnessRunService.adoptPublishedRun(RUN_ID)
      ).rejects.toThrow('still active');
    });
  });

  describe('recordPublish', () => {
    it('stores head sha and PR URL while the run is active', async () => {
      const row = { id: RUN_ID, head_sha: 'abc123', status: 'running' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(
        HarnessRunService.recordPublish(RUN_ID, 7, { headSha: ' abc123 ' })
      ).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('head_sha = COALESCE');
      expect(sql).toContain('pr_url = COALESCE');
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain('agent_id = $2');
      expect(params).toEqual([RUN_ID, 7, 'abc123', null]);
    });

    it('requires head sha or PR URL', async () => {
      await expect(
        HarnessRunService.recordPublish(RUN_ID, 7, {})
      ).rejects.toThrow('headSha or prUrl is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects a publish update for a non-active run', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        HarnessRunService.recordPublish(RUN_ID, 7, { prUrl: 'https://example/pull/1' })
      ).rejects.toThrow('Active harness run not found');
    });
  });
});
