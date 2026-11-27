jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/DependencyService', () => ({
  assertReady: jest.fn().mockResolvedValue({ ready: true }),
}));

jest.mock('../services/HarnessEventService', () => ({
  ensureTerminalEvent: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/HarnessBudgetService', () => ({
  assertCanStart: jest.fn().mockResolvedValue({}),
}));

jest.mock('../services/HarnessAuditService', () => ({
  recordPrivacy: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/HarnessPrivacyService', () => ({
  assertProviderAllowed: jest.fn().mockResolvedValue({ source: 'default' }),
}));

const HarnessRunService = require('../services/HarnessRunService');
const DependencyService = require('../services/DependencyService');
const HarnessEventService = require('../services/HarnessEventService');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessPrivacyService = require('../services/HarnessPrivacyService');
const HarnessAuditService = require('../services/HarnessAuditService');
const { pool } = require('../db');

const RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('HarnessRunService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    DependencyService.assertReady.mockResolvedValue({ ready: true });
    HarnessEventService.ensureTerminalEvent.mockResolvedValue(null);
    HarnessBudgetService.assertCanStart.mockResolvedValue({ reservedCostUsd: 2 });
    HarnessPrivacyService.assertProviderAllowed.mockResolvedValue({ source: 'default' });
  });

  describe('startRun', () => {
    function clientWith(ownership, insert, extra = []) {
      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: ownership })
        .mockResolvedValueOnce(insert);
      for (const response of extra) {
        client.query.mockResolvedValueOnce(response);
      }
      client.query.mockResolvedValueOnce({}); // COMMIT or ROLLBACK
      pool.connect.mockResolvedValueOnce(client);
      return client;
    }

    it('persists a runtime-owned run with normalised ids', async () => {
      const row = { id: RUN_ID, ticket_id: 42, runtime_id: 7, status: 'running' };
      const client = clientWith(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        { rows: [row] }
      );

      const result = await HarnessRunService.startRun({
        ticketId: '42',
        runtimeId: 7,
        branch: ' feat/fg-33 ',
        baseSha: 'abc123',
        provider: 'anthropic',
        model: 'claude',
      });

      expect(result).toEqual(row);
      expect(result.budget_policy).toEqual({ reservedCostUsd: 2 });
      expect(DependencyService.assertReady).toHaveBeenCalledWith(42, {
        client,
        lock: true,
        action: 'durable_start',
      });
      expect(HarnessBudgetService.assertCanStart).toHaveBeenCalledWith(
        expect.objectContaining({ runtimeId: 7, ticketId: 42, projectId: 5 })
      );
      const [sql, params] = client.query.mock.calls[2];
      expect(sql).toContain('INSERT INTO harness_runs');
      expect(sql).toContain('runtime_id');
      expect(sql).not.toContain('agent_id');
      expect(sql).toContain('t.assigned_runtime_id = $2');
      expect(sql).toContain('existing.head_sha');
      expect(params).toEqual([
        42,
        7,
        'feat/fg-33',
        'abc123',
        null,
        null,
        'anthropic',
        'claude',
        1,
        null,
        null,
        2,
        null,
        null,
        'build',
        null,
      ]);
    });

    it('rejects a legacy agent identity instead of falling back', async () => {
      await expect(HarnessRunService.startRun({
        ticketId: 42, agentId: 7, branch: 'feat/fg-54',
      })).rejects.toThrow('runtimeId is required');
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('audits a provider-policy start rejection without creating a run', async () => {
      const client = clientWith(
        [{ status: 'in_progress', assigned_runtime_id: '3', project_id: 5 }],
        { rows: [] }
      );
      HarnessPrivacyService.assertProviderAllowed.mockRejectedValueOnce(
        new Error("Provider 'anthropic' is not allowed by the project privacy policy")
      );

      await expect(HarnessRunService.startRun({
        ticketId: 42,
        runtimeId: 3,
        branch: 'feat/fg-42',
        provider: 'anthropic',
      })).rejects.toThrow('not allowed by the project privacy policy');

      expect(HarnessAuditService.recordPrivacy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 5,
          action: 'start_blocked',
          ticketId: 42,
          runtimeId: 3,
          actorId: 3,
          actorType: 'runtime',
          dedupeKey: 'privacy:start_blocked:42:anthropic',
        })
      );
      expect(client.release).toHaveBeenCalled();
    });

    it('persists a project-scoped repo profile revision when provided', async () => {
      const row = { id: RUN_ID, ticket_id: 42, runtime_id: 7, status: 'running' };
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({
            rows: [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
          })
          .mockResolvedValueOnce({
            rows: [{ id: '11111111-1111-4111-8111-111111111111', version: 3 }],
          })
          .mockResolvedValueOnce({ rows: [row] }) // INSERT
          .mockResolvedValueOnce({}), // COMMIT
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      await HarnessRunService.startRun({
        ticketId: 42,
        runtimeId: 7,
        branch: 'feat/fg-39',
        repoProfileId: '11111111-1111-4111-8111-111111111111',
        repoProfileVersion: 3,
      });

      expect(client.query.mock.calls[2][0]).toContain('FROM repo_profiles');
      expect(client.query.mock.calls[2][0]).toContain("rp.status = 'active'");
      expect(client.query.mock.calls[2][0]).toContain('v.profile_hash = rp.profile_hash');
      expect(client.query.mock.calls[3][1].slice(-7)).toEqual([
        '11111111-1111-4111-8111-111111111111',
        3,
        2,
        null,
        null,
        'build',
        null,
      ]);
    });

    it('rejects a repo profile from another project or with a mismatched version', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({}) // BEGIN
          .mockResolvedValueOnce({
            rows: [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
          })
          .mockResolvedValueOnce({ rows: [] }), // no matching profile
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      await expect(HarnessRunService.startRun({
        ticketId: 42,
        runtimeId: 7,
        branch: 'feat/fg-39',
        repoProfileId: '11111111-1111-4111-8111-111111111111',
        repoProfileVersion: 3,
      })).rejects.toThrow(/does not belong/);
      expect(client.query.mock.calls.some((call) => String(call[0]).includes('INSERT INTO harness_runs')))
        .toBe(false);
    });

    it('requires the profile id and version together', async () => {
      await expect(HarnessRunService.startRun({
        ticketId: 42,
        runtimeId: 7,
        branch: 'feat/fg-39',
        repoProfileId: '11111111-1111-4111-8111-111111111111',
      })).rejects.toThrow(/provided together/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects a missing ticket id', async () => {
      await expect(
        HarnessRunService.startRun({ runtimeId: 7, branch: 'b' })
      ).rejects.toThrow('ticketId must be a positive integer');
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('rejects a blank branch', async () => {
      await expect(
        HarnessRunService.startRun({ ticketId: 1, runtimeId: 7, branch: '  ' })
      ).rejects.toThrow('branch is required');
    });

    it('rejects a non-positive attempt', async () => {
      await expect(
        HarnessRunService.startRun({ ticketId: 1, runtimeId: 7, branch: 'b', attempt: 0 })
      ).rejects.toThrow('attempt must be a positive integer');
    });

    it('requires the ticket to be assigned to the runtime', async () => {
      clientWith(
        [{ status: 'in_progress', assigned_runtime_id: '9', project_id: 5 }],
        { rows: [] },
        [{ rows: [{ status: 'in_progress', assigned_runtime_id: '9' }] }]
      );

      await expect(
        HarnessRunService.startRun({ ticketId: 42, runtimeId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket is not assigned to this runtime');
    });

    it('maps the active-run unique index to a conflict', async () => {
      const error = new Error('duplicate key');
      error.code = '23505';
      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      client.query
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          rows: [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        })
        .mockRejectedValueOnce(error)
        .mockResolvedValueOnce({});
      pool.connect.mockResolvedValueOnce(client);

      await expect(
        HarnessRunService.startRun({ ticketId: 42, runtimeId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket already has an active harness run');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('refuses a new run when dependencies are not ready', async () => {
      const client = clientWith(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        { rows: [] }
      );
      DependencyService.assertReady.mockRejectedValueOnce(
        Object.assign(new Error('Cannot start: 2 dependencies are not done'), {
          code: 'DEPENDENCIES_NOT_DONE',
        })
      );

      await expect(
        HarnessRunService.startRun({ ticketId: 42, runtimeId: 7, branch: 'b' })
      ).rejects.toThrow('Cannot start: 2 dependencies are not done');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.query.mock.calls[2][0]).not.toContain('INSERT INTO harness_runs');
    });

    it('does not probe dependencies for a ticket owned by another runtime', async () => {
      clientWith(
        [{ status: 'in_progress', assigned_runtime_id: '9', project_id: 5 }],
        { rows: [] },
        [{ rows: [] }]
      );

      await expect(
        HarnessRunService.startRun({ ticketId: 42, runtimeId: 7, branch: 'b' })
      ).rejects.toThrow('Ticket is not assigned to this runtime');
      expect(DependencyService.assertReady).not.toHaveBeenCalled();
    });

    const FIX_ID = '22222222-2222-4222-8222-222222222222';
    const FIX_BASE = 'a'.repeat(40);

    function fixClient(ownership, claim, insert) {
      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      // The claim is locked before the ticket to match FixQueueService.claim's
      // order (request -> ticket), avoiding a lock-order deadlock.
      client.query
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: claim })
        .mockResolvedValueOnce({ rows: ownership })
        .mockResolvedValueOnce(insert)
        .mockResolvedValueOnce({}); // COMMIT
      pool.connect.mockResolvedValueOnce(client);
      return client;
    }

    function liveClaim(overrides = {}) {
      return {
        id: '22222222-2222-4222-8222-222222222222',
        branch: 'feat/fix',
        reviewed_sha: 'a'.repeat(40),
        lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
        ...overrides,
      };
    }

    function fixRun(overrides = {}) {
      return {
        ticketId: 42,
        runtimeId: 7,
        branch: 'feat/fix',
        baseSha: FIX_BASE,
        purpose: 'fix',
        fixRequestId: FIX_ID,
        ...overrides,
      };
    }

    it('authorises a fix run from the matching claim and skips the PR guard', async () => {
      const row = { id: RUN_ID, ticket_id: 42, runtime_id: 7, purpose: 'fix' };
      const client = fixClient(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        [liveClaim()],
        { rows: [row] }
      );

      await expect(HarnessRunService.startRun(fixRun())).resolves.toEqual(row);

      const [claimSql, claimParams] = client.query.mock.calls[1];
      expect(claimSql).toContain('FROM ticket_fix_requests');
      expect(claimSql).toContain("state IN ('claimed', 'fixing')");
      expect(claimSql).toContain('lease_expires_at > NOW()');
      expect(claimParams).toEqual([FIX_ID, 42, 7]);
      // Lock order must match FixQueueService.claim: request first, ticket last.
      expect(client.query.mock.calls[2][0]).toContain('FROM tickets');
      const [insertSql, insertParams] = client.query.mock.calls[3];
      expect(insertSql).toContain('purpose, fix_request_id');
      expect(insertSql).not.toContain('existing.head_sha');
      expect(insertParams.slice(-2)).toEqual(['fix', FIX_ID]);
    });

    it('refuses a fix run without a live claim', async () => {
      const client = fixClient(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        [],
        { rows: [] }
      );

      await expect(HarnessRunService.startRun(fixRun()))
        .rejects.toThrow('Fix request is missing, unclaimed or stale');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.query.mock.calls.some(
        ([sql]) => String(sql).includes('INSERT INTO harness_runs'))).toBe(false);
    });

    it('refuses a fix run with an expired lease from the same runtime', async () => {
      const client = fixClient(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        [liveClaim({ lease_expires_at: new Date(Date.now() - 1_000).toISOString() })],
        { rows: [] }
      );

      await expect(HarnessRunService.startRun(fixRun()))
        .rejects.toThrow('Fix request lease has expired; reclaim it');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.query.mock.calls.some(
        ([sql]) => String(sql).includes('INSERT INTO harness_runs'))).toBe(false);
    });

    it('refuses a fix run whose branch does not match the claim', async () => {
      fixClient(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        [liveClaim({ branch: 'feat/other' })],
        { rows: [{ id: RUN_ID }] }
      );

      await expect(HarnessRunService.startRun(fixRun()))
        .rejects.toThrow('Fix request branch does not match the run branch');
    });

    it('refuses a fix run whose base SHA does not match the claim', async () => {
      fixClient(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        [liveClaim({ reviewed_sha: 'b'.repeat(40) })],
        { rows: [{ id: RUN_ID }] }
      );

      await expect(HarnessRunService.startRun(fixRun()))
        .rejects.toThrow('Fix request reviewed SHA does not match the run base SHA');
    });

    it('trims the base SHA before storing and comparing it', async () => {
      const client = fixClient(
        [{ status: 'in_progress', assigned_runtime_id: '7', project_id: 5 }],
        [liveClaim()],
        { rows: [{ id: RUN_ID }] }
      );

      await HarnessRunService.startRun(
        fixRun({ branch: ' feat/fix ', baseSha: ` ${FIX_BASE} ` }));

      expect(client.query.mock.calls[1][1]).toEqual([FIX_ID, 42, 7]);
      const insertParams = client.query.mock.calls[3][1];
      expect(insertParams[2]).toBe('feat/fix');
      expect(insertParams[3]).toBe(FIX_BASE);
    });

    it('maps a deadlock abort to a retryable conflict', async () => {
      const client = {
        query: jest.fn(),
        release: jest.fn(),
      };
      const deadlock = Object.assign(new Error('deadlock detected'), { code: '40P01' });
      client.query
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(deadlock)
        .mockResolvedValueOnce({});
      pool.connect.mockResolvedValueOnce(client);

      await expect(HarnessRunService.startRun(fixRun()))
        .rejects.toThrow('Concurrent run start or fix claim; retry');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('validates purpose, fixRequestId and the fix base SHA before connecting', async () => {
      await expect(HarnessRunService.startRun(fixRun({ purpose: 'review' })))
        .rejects.toThrow("purpose must be 'build' or 'fix'");
      await expect(HarnessRunService.startRun(fixRun({ fixRequestId: null })))
        .rejects.toThrow('fixRequestId is required for a fix run');
      await expect(HarnessRunService.startRun(fixRun({ baseSha: null })))
        .rejects.toThrow('baseSha is required for a fix run');
      await expect(HarnessRunService.startRun(fixRun({ purpose: 'build' })))
        .rejects.toThrow('fixRequestId is only valid with purpose=fix');
      expect(pool.connect).not.toHaveBeenCalled();
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

    it('lists only running runs for a runtime', async () => {
      const rows = [{ id: RUN_ID, status: 'running' }];
      pool.query.mockResolvedValueOnce({ rows });

      await expect(
        HarnessRunService.listActiveRunsForActor({ runtimeId: 7 })
      ).resolves.toEqual(rows);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain('last_checkpoint_payload');
      expect(sql).toContain('ticket_status');
      expect(sql).toContain('lease_expires_at');
      expect(sql).toContain('LEFT JOIN LATERAL');
      expect(sql).toContain('r.runtime_id = $1');
      expect(params).toEqual([7]);
    });

    it('rejects an active-run listing without a runtime', async () => {
      await expect(
        HarnessRunService.listActiveRunsForActor({ agentId: 7 })
      ).rejects.toThrow('runtimeId is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('lists recent project runs for replay with a bounded limit', async () => {
      const rows = [{ id: RUN_ID, ticket_title: 'Smoke' }];
      pool.query.mockResolvedValueOnce({ rows });

      await expect(
        HarnessRunService.listRunsForProject(7, { limit: 10 })
      ).resolves.toEqual(rows);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('COALESCE(r.project_id, t.project_id) = $1');
      expect(sql).toContain('ORDER BY r.started_at DESC');
      expect(sql).toContain('ticket_title');
      expect(params).toEqual([7, 10]);
    });

    it('rejects an out-of-range project run limit', async () => {
      await expect(
        HarnessRunService.listRunsForProject(7, { limit: 500 })
      ).rejects.toThrow('limit must be an integer between 1 and 200');
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

    it('redacts PII from checkpoint payloads before storage', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: 'cp-1' }] });

      await HarnessRunService.recordCheckpoint(RUN_ID, 'cloned', {
        note: 'mail alice@example.com',
        workspacePath: '/tmp/ws',
      });

      const json = pool.query.mock.calls[0][1][2];
      expect(json).not.toContain('alice@example.com');
      expect(json).toContain('[REDACTED_EMAIL]');
      expect(json).toContain('/tmp/ws');
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
    it('updates heartbeat and optional step for the owning runtime', async () => {
      const row = { id: RUN_ID, runtime_id: 7, step: 'verifying' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(
        HarnessRunService.heartbeat(RUN_ID, { runtimeId: 7 }, 'verifying')
      ).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('heartbeat_at = NOW()');
      expect(sql).toContain('agent_step = COALESCE');
      expect(sql).not.toContain('step = COALESCE($3, step)');
      expect(sql).toContain('runtime_id = $2');
      expect(sql).not.toContain('agent_id');
      expect(params).toEqual([RUN_ID, 7, 'verifying']);
    });

    it('leaves the step untouched when omitted', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: RUN_ID }] });

      await HarnessRunService.heartbeat(RUN_ID, { runtimeId: 7 });

      expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, 7, null]);
    });

    it('rejects a legacy scalar actor without a runtime', async () => {
      await expect(
        HarnessRunService.heartbeat(RUN_ID, 7, 'verifying')
      ).rejects.toThrow('runtimeId is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('throws when no active run matches the runtime', async () => {
      await expect(
        HarnessRunService.heartbeat(RUN_ID, { runtimeId: 7 })
      ).rejects.toThrow('Active harness run not found');
    });
  });

  describe('waiting for a human (fg-55)', () => {
    it('marks a running run waiting without moving the status', async () => {
      const row = { id: RUN_ID, waiting_since: '2026-11-22T10:00:00.000Z' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(HarnessRunService.markWaiting(RUN_ID)).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('waiting_since = COALESCE(waiting_since, NOW())');
      expect(sql).toContain('heartbeat_at = NOW()');
      expect(sql).toContain("status = 'running'");
      expect(params).toEqual([RUN_ID]);
    });

    it('clears waiting and adds the elapsed time to waited_ms', async () => {
      const row = { id: RUN_ID, waiting_since: null, waited_ms: 65000 };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(HarnessRunService.clearWaiting(RUN_ID)).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('waited_ms = waited_ms');
      expect(sql).toContain('waiting_since = NULL');
      expect(params).toEqual([RUN_ID]);
    });

    it('finish expires pending questions and notifies recipients in one statement', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ id: RUN_ID, status: 'succeeded' }] });

      await HarnessRunService.finishRun(RUN_ID, { status: 'succeeded' });

      const [sql] = pool.query.mock.calls[0];
      expect(sql).toContain('waiting_since = NULL');
      expect(sql).toContain('expired_questions AS');
      expect(sql).toContain('INSERT INTO notifications');
      expect(sql).toContain("perm.code = 'AGENT_READ'");
      expect(sql).toContain("WHEN 'succeeded' THEN 'run_succeeded'");
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
      expect(HarnessEventService.ensureTerminalEvent).toHaveBeenCalledWith(
        expect.objectContaining({ runId: RUN_ID, status: 'succeeded' })
      );
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

    it('redacts PII from run errors and audits a privacy block', async () => {
      const row = {
        id: RUN_ID,
        status: 'failed',
        error: 'PII pattern detected for alice@example.com',
        project_id: 5,
        ticket_id: 42,
        runtime_id: 7,
      };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await HarnessRunService.finishRun(RUN_ID, {
        status: 'failed',
        error: 'PII pattern detected for alice@example.com',
      });

      const [, params] = pool.query.mock.calls[0];
      expect(params[2]).not.toContain('alice@example.com');
      expect(params[2]).toContain('[REDACTED_EMAIL]');
      expect(HarnessAuditService.recordPrivacy).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 5,
          runtimeId: 7,
          actorId: 7,
          action: 'run_blocked',
          actorType: 'runtime',
        })
      );
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
      const lease = { ticket_id: 42, run_id: RUN_ID, runtime_id: 7 };
      pool.query.mockResolvedValueOnce({ rows: [lease] });

      await expect(
        HarnessRunService.claimLease({
          ticketId: 42,
          runId: RUN_ID,
          runtimeId: 7,
          ttlSeconds: 120,
        })
      ).resolves.toEqual(lease);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('ON CONFLICT (ticket_id) DO UPDATE');
      expect(sql).toContain('EXISTS');
      expect(sql).toContain('r.runtime_id = $3');
      expect(sql).toContain('t.assigned_runtime_id = $3');
      expect(sql).not.toContain('agent_id');
      expect(params).toEqual([42, RUN_ID, 7, 120]);
    });

    it('rejects a lease claim without a runtime', async () => {
      await expect(
        HarnessRunService.claimLease({ ticketId: 42, runId: RUN_ID, agentId: 7 })
      ).rejects.toThrow('runtimeId is required');
    });

    it('returns null when another run holds an unexpired lease', async () => {
      await expect(
        HarnessRunService.claimLease({ ticketId: 42, runId: RUN_ID, runtimeId: 7 })
      ).resolves.toBeNull();
    });

    it('rejects an out-of-range lease ttl', async () => {
      await expect(
        HarnessRunService.claimLease({
          ticketId: 42,
          runId: RUN_ID,
          runtimeId: 7,
          ttlSeconds: 0,
        })
      ).rejects.toThrow('ttlSeconds must be an integer between 1 and 86400');
    });

    it('renews an unexpired lease for the owning runtime', async () => {
      const lease = { ticket_id: 42, run_id: RUN_ID, runtime_id: 7 };
      pool.query.mockResolvedValueOnce({ rows: [lease] });

      await expect(
        HarnessRunService.renewLease({ ticketId: 42, runId: RUN_ID, runtimeId: 7 })
      ).resolves.toEqual(lease);
      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('expires_at > NOW()');
      expect(sql).toContain("r.status = 'running'");
      expect(sql).toContain('l.ticket_id = r.ticket_id');
      expect(sql).toContain('l.runtime_id = r.runtime_id');
      expect(sql).toContain('t.assigned_runtime_id = $3');
      expect(sql).not.toContain('agent_id');
      expect(params).toEqual([42, RUN_ID, 7, 600]);
    });

    it('returns null when renewing a lost lease', async () => {
      await expect(
        HarnessRunService.renewLease({ ticketId: 42, runId: RUN_ID, runtimeId: 7 })
      ).resolves.toBeNull();
    });

    it('reports whether a lease was released', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ticket_id: 42 }] });
      await expect(HarnessRunService.releaseLease(42, RUN_ID)).resolves.toBe(true);

      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(HarnessRunService.releaseLease(42, RUN_ID)).resolves.toBe(false);
    });

    it('reaps expired leases with SKIP LOCKED and fails their runs', async () => {
      const rows = [{ ticket_id: 42, run_id: RUN_ID, runtime_id: 7, run_failed: true }];
      pool.query.mockResolvedValueOnce({ rows });

      await expect(HarnessRunService.reapExpiredLeases(10)).resolves.toEqual(rows);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('FOR UPDATE SKIP LOCKED');
      expect(sql).toContain("NULLIF(BTRIM(r.pr_url), '') IS NOT NULL THEN 'succeeded'");
      expect(sql).toContain("status = 'failed'");
      expect(sql).toContain('run has no lease and heartbeat is stale');
      expect(sql).not.toContain('agent_id');
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
      expect(sql).toContain('t.assigned_runtime_id = run.runtime_id');
      expect(sql).not.toContain('agent_id');
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
      const ticket = { id: 42, status: 'backlog', assigned_runtime_id: null };
      pool.query.mockResolvedValueOnce({ rows: [ticket] });

      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID)
      ).resolves.toEqual(ticket);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain("r.status IN ('failed', 'budget_exceeded')");
      expect(sql).toContain("NULLIF(BTRIM(r.pr_url), '') IS NULL");
      expect(sql).toContain("NULLIF(BTRIM(r.head_sha), '') IS NULL");
      expect(sql).toContain("t.status = 'in_progress'");
      expect(sql).toContain('t.assigned_runtime_id = run.runtime_id');
      expect(sql).toContain("NULLIF(BTRIM(t.pr_url), '') IS NULL");
      expect(sql).toContain('NOT EXISTS');
      expect(sql).not.toContain('agent_id');
      expect(params).toEqual([RUN_ID, null]);
    });

    it('scopes a runtime-initiated release to its own run', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID, { runtimeId: 3 })
      ).resolves.toBeNull();
      expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, 3]);
    });

    it('rejects a legacy agent-initiated release', async () => {
      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID, { agentId: 7 })
      ).resolves.toBeNull();
      // Only runtimeId is read; an unknown option is ignored.
      expect(pool.query.mock.calls[0][1]).toEqual([RUN_ID, null]);
    });

    it('allows an operator to release a dead-letter run explicitly', async () => {
      const ticket = { id: 42, status: 'backlog', assigned_runtime_id: null };
      pool.query.mockResolvedValueOnce({ rows: [ticket] });

      await expect(
        HarnessRunService.releaseTicketForRun(RUN_ID, { allowDeadLetter: true })
      ).resolves.toEqual(ticket);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain(
        "r.status IN ('failed', 'dead_letter', 'budget_exceeded')"
      );
      expect(params).toEqual([RUN_ID, null]);
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
      const row = { id: RUN_ID, head_sha: 'abc123', runtime_id: 7, status: 'running' };
      pool.query.mockResolvedValueOnce({ rows: [row] });

      await expect(
        HarnessRunService.recordPublish(RUN_ID, { runtimeId: 7 }, { headSha: ' abc123 ' })
      ).resolves.toEqual(row);

      const [sql, params] = pool.query.mock.calls[0];
      expect(sql).toContain('head_sha = COALESCE');
      expect(sql).toContain('pr_url = COALESCE');
      expect(sql).toContain("status = 'running'");
      expect(sql).toContain('runtime_id = $2');
      expect(sql).not.toContain('agent_id');
      expect(params).toEqual([RUN_ID, 7, 'abc123', null]);
    });

    it('requires head sha or PR URL', async () => {
      await expect(
        HarnessRunService.recordPublish(RUN_ID, { runtimeId: 7 }, {})
      ).rejects.toThrow('headSha or prUrl is required');
      expect(pool.query).not.toHaveBeenCalled();
    });

    it('rejects a publish update for a non-active run', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        HarnessRunService.recordPublish(RUN_ID, { runtimeId: 7 }, {
          prUrl: 'https://example/pull/1',
        })
      ).rejects.toThrow('Active harness run not found');
    });

    it('rejects a publish update without a runtime', async () => {
      await expect(
        HarnessRunService.recordPublish(RUN_ID, 7, { headSha: 'abc123' })
      ).rejects.toThrow('runtimeId is required');
    });
  });
});
