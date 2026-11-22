jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
  },
}));

jest.mock('../services/ReadinessEvaluator', () => ({
  evaluate: jest.fn(),
  extractSection: jest.fn(),
}));

jest.mock('../services/ProjectAccessService', () => ({
  actorUserId: jest.fn(actor => actor?.userId ?? null),
  assertProjectMember: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/ReadinessMetrics', () => ({
  increment: jest.fn(),
}));

const { pool } = require('../db');
const ReadinessEvaluator = require('../services/ReadinessEvaluator');
const ProjectAccessService = require('../services/ProjectAccessService');
const TicketReadinessService = require('../services/TicketReadinessService');
const { ReadinessError, ValidationError, ForbiddenError } = require('../errors/HttpError');

function context(overrides = {}) {
  return {
    ticket: {
      id: 1,
      projectId: '7',
      title: 'A sufficiently descriptive title',
      description: 'In scope: x. Out of scope: y. '.repeat(4),
      templateSchema: 'architecture',
      planningStatus: 'not_started',
      planApprovedAt: null,
      readyAt: null,
      readinessWaivedCodes: [],
      readinessOverrideExpiresAt: null,
      readinessGrandfatheredAt: null,
      readinessRequirementIds: [],
      ...overrides.ticket,
    },
    files: {},
    criteria: ['criterion'],
    template: { name: 'architecture', files: [], sectionsEnforced: true },
    smallFix: null,
    waivedCodes: [],
    ...overrides,
  };
}

function notReadyResult(codes = ['DESCRIPTION_TOO_SHORT']) {
  const issues = codes.map(code => ({ code, message: code, waivable: true }));
  return {
    ready: false,
    issues,
    allIssues: issues,
    waivedCodes: [],
    requirements: [],
  };
}

describe('TicketReadinessService gate modes', () => {
  const originalMode = process.env.READINESS_GATE_MODE;

  afterEach(() => {
    if (originalMode === undefined) delete process.env.READINESS_GATE_MODE;
    else process.env.READINESS_GATE_MODE = originalMode;
    jest.restoreAllMocks();
    ReadinessEvaluator.evaluate.mockReset();
  });

  test('off skips evaluation entirely', async () => {
    process.env.READINESS_GATE_MODE = 'off';
    const loadSpy = jest.spyOn(TicketReadinessService, 'loadContext');

    const result = await TicketReadinessService.assertReadyForExecution(1, { source: 'pickup' });

    expect(result).toEqual({ ready: true, skipped: true, mode: 'off' });
    expect(loadSpy).not.toHaveBeenCalled();
    loadSpy.mockRestore();
  });

  test('warn records the block and allows the transition', async () => {
    process.env.READINESS_GATE_MODE = 'warn';
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    ReadinessEvaluator.evaluate.mockReturnValue(notReadyResult());

    const result = await TicketReadinessService.assertReadyForExecution(1, {
      source: 'pickup',
      toStatus: 'in_progress',
      actor: { type: 'agent', userId: 5 },
    });

    expect(result.blocked).toBe(true);
    expect(result.mode).toBe('warn');
    expect(result.attemptId).toBeTruthy();
    expect(result.issues.map(issue => issue.code)).toContain('DESCRIPTION_TOO_SHORT');
  });

  test('enforce throws READINESS_FAILED with the issue list', async () => {
    process.env.READINESS_GATE_MODE = 'enforce';
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    ReadinessEvaluator.evaluate.mockReturnValue(notReadyResult(['MISSING_TEMPLATE']));

    await expect(
      TicketReadinessService.assertReadyForExecution(1, { source: 'pickup' })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: 'READINESS_FAILED',
      details: { issues: [expect.objectContaining({ code: 'MISSING_TEMPLATE' })] },
    });
  });

  test('grandfathered tickets skip the gate', async () => {
    process.env.READINESS_GATE_MODE = 'enforce';
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(
      context({ ticket: { readinessGrandfatheredAt: '2026-11-01T00:00:00Z' } })
    );

    const result = await TicketReadinessService.assertReadyForExecution(1, { source: 'pickup' });

    expect(result).toMatchObject({ ready: true, skipped: true, grandfathered: true });
    expect(ReadinessEvaluator.evaluate).not.toHaveBeenCalled();
  });

  test('a ready ticket proceeds', async () => {
    process.env.READINESS_GATE_MODE = 'enforce';
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    ReadinessEvaluator.evaluate.mockReturnValue({ ...notReadyResult(), ready: true, issues: [], allIssues: [] });

    const result = await TicketReadinessService.assertReadyForExecution(1, { source: 'pickup' });

    expect(result.ready).toBe(true);
    expect(result.blocked).toBeUndefined();
  });
});

describe('TicketReadinessService approve and refresh', () => {
  function clientFor(row) {
    const client = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('FOR UPDATE')) return { rows: [row] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    return client;
  }

  afterEach(() => {
    jest.restoreAllMocks();
    ReadinessEvaluator.evaluate.mockReset();
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('approve-plan rejects when blocking content issues remain', async () => {
    const row = {
      id: 1,
      project_id: '7',
      readiness_grandfathered_at: null,
      planning_status: 'in_progress',
    };
    const client = clientFor(row);
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    ReadinessEvaluator.evaluate.mockReturnValue({
      ...notReadyResult(['DESCRIPTION_TOO_SHORT']),
      allIssues: [
        { code: 'DESCRIPTION_TOO_SHORT', message: 'short', waivable: true },
        { code: 'PLAN_NOT_APPROVED', message: 'approve', waivable: false },
      ],
    });

    await expect(
      TicketReadinessService.approvePlan(1, { type: 'user', userId: 5, role: 'project_admin' })
    ).rejects.toBeInstanceOf(ReadinessError);

    expect(client.query.mock.calls.some(call => String(call[0]).includes('ROLLBACK'))).toBe(true);
  });

  test('approve-plan records approval and ready_at when only approval was missing', async () => {
    const row = {
      id: 1,
      project_id: '7',
      readiness_grandfathered_at: null,
      planning_status: 'in_progress',
    };
    const client = clientFor(row);
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    jest.spyOn(TicketReadinessService, 'recordEvent').mockResolvedValue(undefined);
    const txReady = {
      ...notReadyResult(),
      ready: false,
      issues: [{ code: 'PLAN_NOT_APPROVED', message: 'approve', waivable: false }],
      allIssues: [{ code: 'PLAN_NOT_APPROVED', message: 'approve', waivable: false }],
      requirements: [{ id: 'FR1', text: 'x', acceptance: 'done' }],
    };
    ReadinessEvaluator.evaluate.mockReturnValue(txReady);

    await TicketReadinessService.approvePlan(1, { type: 'user', userId: 5, role: 'project_admin' });

    const update = client.query.mock.calls.find(call =>
      String(call[0]).includes('plan_approved_at') && String(call[0]).includes('UPDATE'));
    expect(update).toBeDefined();
    expect(String(update[0])).toContain("planning_status = 'completed'");
    expect(String(update[0])).toContain('ready_at = NOW()');
    expect(TicketReadinessService.recordEvent).toHaveBeenCalledWith(
      1,
      'approved',
      expect.objectContaining({ userId: 5 }),
      expect.any(Object)
    );
    expect(ProjectAccessService.assertProjectMember).toHaveBeenCalled();
  });

  test('replan clears a grandfather exemption so the ticket follows the gate', async () => {
    const row = {
      id: 1,
      project_id: '7',
      readiness_grandfathered_at: '2026-11-01T00:00:00Z',
      planning_status: 'completed',
      plan_approved_at: '2026-11-01T00:00:00Z',
      ready_at: '2026-11-01T00:00:00Z',
    };
    const client = clientFor(row);
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    jest.spyOn(TicketReadinessService, 'recordEvent').mockResolvedValue(undefined);
    ReadinessEvaluator.evaluate.mockReturnValue(notReadyResult());

    await TicketReadinessService.replan(1, { type: 'user', userId: 5, role: 'project_admin' });

    const update = client.query.mock.calls.find(call =>
      String(call[0]).includes('readiness_grandfathered_at = NULL'));
    expect(update).toBeDefined();
    expect(String(update[0])).toContain("planning_status = 'in_progress'");
  });

  test('a failing content edit invalidates an approved plan', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(
      context({
        ticket: {
          planApprovedAt: '2026-11-01T00:00:00Z',
          readyAt: '2026-11-01T00:00:00Z',
          planningStatus: 'completed',
        },
      })
    );
    jest.spyOn(TicketReadinessService, 'recordEvent').mockResolvedValue(undefined);
    ReadinessEvaluator.evaluate.mockReturnValue(notReadyResult());

    await TicketReadinessService.refreshReadyState(1, { type: 'user', userId: 5 });

    const invalidation = pool.query.mock.calls.find(call =>
      String(call[0]).includes('plan_approved_at = NULL'));
    expect(invalidation).toBeDefined();
    expect(String(invalidation[0])).toContain("planning_status = 'in_progress'");
    expect(TicketReadinessService.recordEvent).toHaveBeenCalledWith(
      1,
      'approval_invalidated',
      expect.any(Object),
      expect.any(Object)
    );
  });

  test('a passing edit re-sets ready_at without clearing approval', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(
      context({ ticket: { planApprovedAt: '2026-11-01T00:00:00Z' } })
    );
    ReadinessEvaluator.evaluate.mockReturnValue({ ...notReadyResult(), ready: true, issues: [], allIssues: [] });

    await TicketReadinessService.refreshReadyState(1, { type: 'user', userId: 5 });

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('SET ready_at = NOW()'),
      [1, 5]
    );
    expect(pool.query.mock.calls.some(call => String(call[0]).includes('plan_approved_at = NULL'))).toBe(false);
  });
});

describe('TicketReadinessService override membership and events', () => {
  function clientFor(row) {
    const client = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('FOR UPDATE')) return { rows: [row] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);
    return client;
  }

  const row = {
    id: 1,
    project_id: '7',
    readiness_waived_codes: ['MISSING_ROLLBACK'],
    readiness_override_expires_at: '2026-12-01T00:00:00Z',
  };
  const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  afterEach(() => {
    jest.restoreAllMocks();
    ReadinessEvaluator.evaluate.mockReset();
    ProjectAccessService.assertProjectMember.mockReset();
    ProjectAccessService.assertProjectMember.mockResolvedValue(undefined);
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test.each([
    ['small fix', () => TicketReadinessService.smallFix(1, 'A bounded reason', { type: 'user', userId: 5, role: 'member' })],
    ['replan', () => TicketReadinessService.replan(1, { type: 'user', userId: 5, role: 'member' })],
    ['override', () => TicketReadinessService.override(1, {
      codes: ['MISSING_ROLLBACK'],
      reason: 'A bounded reason',
      expiresAt: future,
    }, { type: 'user', userId: 5, role: 'member' })],
  ])('%s requires project membership', async (_label, action) => {
    clientFor(row);
    ProjectAccessService.assertProjectMember.mockRejectedValueOnce(
      new ForbiddenError('Not a project member')
    );

    await expect(action()).rejects.toBeInstanceOf(ForbiddenError);
  });

  test('override grants and revocations write audit events', async () => {
    clientFor(row);
    jest.spyOn(TicketReadinessService, 'loadContext').mockResolvedValue(context());
    ReadinessEvaluator.evaluate.mockReturnValue({ ...notReadyResult(), ready: true, issues: [], allIssues: [] });
    jest.spyOn(TicketReadinessService, 'refreshReadyState').mockResolvedValue(undefined);
    const record = jest.spyOn(TicketReadinessService, 'recordEvent').mockResolvedValue(undefined);

    await TicketReadinessService.override(1, {
      codes: ['MISSING_ROLLBACK'],
      reason: 'A bounded reason',
      expiresAt: future,
    }, { type: 'user', userId: 5, role: 'project_admin' });
    expect(record).toHaveBeenCalledWith(
      1,
      'override_granted',
      expect.any(Object),
      expect.objectContaining({ waivedCodes: ['MISSING_ROLLBACK'] })
    );

    await TicketReadinessService.revokeOverride(1, {
      type: 'user',
      userId: 5,
      role: 'project_admin',
    });
    expect(record).toHaveBeenCalledWith(
      1,
      'override_revoked',
      expect.any(Object),
      expect.objectContaining({ waivedCodes: ['MISSING_ROLLBACK'] })
    );
  });

  test('the expiry sweep ignores deleted tickets and writes override_expired once', async () => {
    pool.query
      .mockResolvedValueOnce({
        rows: [{
          id: 1,
          readiness_waived_codes: ['MISSING_ROLLBACK'],
          readiness_override_expires_at: '2026-11-01T00:00:00Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    jest.spyOn(TicketReadinessService, 'refreshReadyState').mockResolvedValue(undefined);
    const record = jest.spyOn(TicketReadinessService, 'recordEvent').mockResolvedValue(undefined);

    const result = await TicketReadinessService.sweepExpiredOverrides(new Date('2026-11-22T00:00:00Z'));

    expect(result.swept).toBe(1);
    expect(String(pool.query.mock.calls[0][0])).toContain('deleted_at IS NULL');
    expect(record).toHaveBeenCalledWith(
      1,
      'override_expired',
      expect.any(Object),
      expect.objectContaining({ waivedCodes: ['MISSING_ROLLBACK'] })
    );
  });
});

describe('TicketReadinessService overrides and audit', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    pool.query.mockReset();
    pool.query.mockResolvedValue({ rows: [] });
  });

  test('override requires codes, a reason and a future bounded expiry', async () => {
    await expect(
      TicketReadinessService.override(1, { codes: [], reason: 'reason reason', expiresAt: '2030-01-01T00:00:00Z' })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      TicketReadinessService.override(1, { codes: ['MISSING_ROLLBACK'], reason: 'short', expiresAt: '2030-01-01T00:00:00Z' })
    ).rejects.toBeInstanceOf(ValidationError);

    await expect(
      TicketReadinessService.override(1, {
        codes: ['MISSING_ROLLBACK'],
        reason: 'bounded reason',
        expiresAt: new Date(Date.now() + 40 * 24 * 60 * 60 * 1000).toISOString(),
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  test('criteria writes require project membership', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, project_id: '7' }] });
    ProjectAccessService.assertProjectMember.mockRejectedValueOnce(
      new ForbiddenError('Not a project member')
    );

    await expect(
      TicketReadinessService.addCriteria(1, ['A testable criterion'], {
        type: 'user',
        userId: 5,
        role: 'member',
      })
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(ProjectAccessService.assertProjectMember).toHaveBeenCalledWith(
      5,
      '7',
      { role: 'member' },
      expect.anything()
    );
  });

  test('blocked audit rows dedupe on attempt_id', async () => {
    pool.query.mockResolvedValue({ rows: [] });

    await TicketReadinessService.emitBlocked({
      blocked: true,
      ticketId: 1,
      attemptId: '11111111-1111-4111-8111-111111111111',
      source: 'pickup',
      mode: 'enforce',
      issues: [{ code: 'MISSING_TEMPLATE' }],
      waivedCodes: [],
      actor: { type: 'agent', userId: 5 },
    });

    const insert = pool.query.mock.calls.find(call =>
      String(call[0]).includes('ticket_readiness_events'));
    expect(String(insert[0])).toContain('ON CONFLICT (attempt_id) DO NOTHING');
  });
});
