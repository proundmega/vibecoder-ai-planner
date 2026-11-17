jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/HarnessEventService', () => ({
  emit: jest.fn(),
}));

const { pool } = require('../db');
const HarnessEventService = require('../services/HarnessEventService');
const HarnessAuditService = require('../services/HarnessAuditService');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const TRACE_ID = '22222222-2222-4222-8222-222222222222';

describe('HarnessAuditService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockImplementation(async (sql) => (
      String(sql).includes("payload->>'dedupeKey'")
        ? { rows: [] }
        : { rows: [{ trace_id: TRACE_ID }] }
    ));
    HarnessEventService.emit.mockResolvedValue({
      event: { event_id: 'event-1', type: 'audit.publish' },
      duplicate: false,
    });
  });

  it('rejects an unknown audit type', async () => {
    await expect(HarnessAuditService.record({ type: 'audit.unknown' }))
      .rejects.toThrow('Unsupported audit type');
    expect(HarnessEventService.emit).not.toHaveBeenCalled();
  });

  it('returns an existing record for a duplicate dedupe key', async () => {
    const existing = { event_id: 'event-existing', type: 'audit.publish' };
    pool.query.mockImplementation(async (sql) => (
      String(sql).includes("payload->>'dedupeKey'")
        ? { rows: [existing] }
        : { rows: [{ trace_id: TRACE_ID }] }
    ));

    const result = await HarnessAuditService.record({
      type: 'audit.publish',
      runId: RUN_ID,
      dedupeKey: 'publish:abc:url',
    });

    expect(result).toEqual(existing);
    expect(HarnessEventService.emit).not.toHaveBeenCalled();
  });

  it('appends an audit event with actor, reason and SHA evidence', async () => {
    await HarnessAuditService.record({
      type: 'audit.publish',
      runId: RUN_ID,
      actorType: 'agent',
      actorId: 7,
      reason: 'pushed',
      beforeSha: 'before',
      afterSha: 'after',
      prUrl: 'https://github.com/o/r/pull/1',
    });

    expect(HarnessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: TRACE_ID,
        runId: RUN_ID,
        type: 'audit.publish',
        payload: expect.objectContaining({
          actor: { type: 'agent', id: '7' },
          reason: 'pushed',
          beforeSha: 'before',
          afterSha: 'after',
          prUrl: 'https://github.com/o/r/pull/1',
        }),
      })
    );
  });

  it('records publish evidence with a stable dedupe key', async () => {
    await HarnessAuditService.recordPublish({
      runId: RUN_ID,
      headSha: 'abc123',
      prUrl: 'https://github.com/o/r/pull/1',
      actorId: 7,
    });

    expect(HarnessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audit.publish',
        payload: expect.objectContaining({
          dedupeKey: 'publish:abc123:https://github.com/o/r/pull/1',
        }),
      })
    );
  });

  it('records review evidence', async () => {
    await HarnessAuditService.recordReview({
      runId: RUN_ID,
      result: 'changes_requested',
      eventId: 'event-review',
    });

    expect(HarnessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audit.review',
        payload: expect.objectContaining({
          result: 'changes_requested',
          dedupeKey: 'review:event-review:changes_requested',
        }),
      })
    );
  });

  it('exposes merge and rollback recorders for fg-36', async () => {
    await HarnessAuditService.recordMerge({ runId: RUN_ID, actorType: 'human' });
    await HarnessAuditService.recordRollback({ runId: RUN_ID, actorType: 'human' });

    const types = HarnessEventService.emit.mock.calls.map((call) => call[0].type);
    expect(types).toEqual(['audit.merge', 'audit.rollback']);
  });

  it('records privacy policy decisions with a dedupe key', async () => {
    await HarnessAuditService.recordPrivacy({
      projectId: 7,
      action: 'policy_updated',
      actorId: 1,
      payload: { policyVersion: 3, maxDataClass: 'internal' },
    });

    expect(HarnessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'audit.privacy',
        projectId: 7,
        payload: expect.objectContaining({
          action: 'policy_updated',
          policyVersion: 3,
          maxDataClass: 'internal',
        }),
      })
    );
  });
});
