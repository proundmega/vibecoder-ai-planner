jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn(),
  },
}));

jest.mock('../services/HarnessRunService', () => ({
  getRun: jest.fn(),
  getCheckpoints: jest.fn(),
}));

const { pool } = require('../db');
const HarnessRunService = require('../services/HarnessRunService');
const HarnessEventService = require('../services/HarnessEventService');
const HarnessMetrics = require('../services/HarnessMetrics');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';

const RUN = {
  id: RUN_ID,
  ticket_id: 42,
  project_id: 7,
  agent_id: 9,
  session_id: 'ses_test',
  ticket_project_id: 7,
};

describe('HarnessEventService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID });
    HarnessRunService.getCheckpoints.mockResolvedValue([]);
  });

  describe('emit', () => {
    it('derives tenant fields from the run and stores a redacted payload', async () => {
      const stored = {
        event_id: EVENT_ID,
        trace_id: TRACE_ID,
        run_id: RUN_ID,
        type: 'tool.called',
        payload: {},
      };
      pool.query
        .mockResolvedValueOnce({ rows: [RUN] })
        .mockResolvedValueOnce({ rows: [stored] });

      const result = await HarnessEventService.emit({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        runId: RUN_ID,
        agentId: 9,
        type: 'tool.called',
        payload: { tool: 'bash', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' },
        requireRunOwnership: true,
      });

      expect(result.duplicate).toBe(false);
      expect(result.event).toEqual(stored);
      const insert = pool.query.mock.calls[1];
      expect(insert[0]).toContain('INSERT INTO harness_events');
      expect(insert[1].slice(0, 7)).toEqual([
        EVENT_ID, TRACE_ID, RUN_ID, 42, 7, 9, 'ses_test',
      ]);
      expect(insert[0]).toContain('event_timestamp');
      expect(Number.isNaN(Date.parse(insert[1][10]))).toBe(false);
      expect(JSON.parse(insert[1][9])).toEqual(expect.objectContaining({
        tool: 'bash',
        token: '[REDACTED]',
      }));
    });

    it('rejects an event from a different agent', async () => {
      pool.query.mockResolvedValueOnce({ rows: [RUN] });

      await expect(HarnessEventService.emit({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        runId: RUN_ID,
        agentId: 10,
        type: 'run.started',
        requireRunOwnership: true,
      })).rejects.toThrow('Harness run belongs to another agent');
    });

    it('validates the event id, trace id and type', async () => {
      await expect(HarnessEventService.emit({
        eventId: 'nope', traceId: TRACE_ID, runId: RUN_ID, type: 'run.started',
      })).rejects.toThrow('eventId must be a UUID');
      await expect(HarnessEventService.emit({
        eventId: EVENT_ID, traceId: 'nope', runId: RUN_ID, type: 'run.started',
      })).rejects.toThrow('traceId must be a UUID');
      await expect(HarnessEventService.emit({
        eventId: EVENT_ID, traceId: TRACE_ID, runId: RUN_ID, type: 'Not A Type',
      })).rejects.toThrow('type must be a dotted lowercase event name');
    });

    it('returns the existing row for a duplicate event id', async () => {
      HarnessMetrics.counters.eventsDuplicates.reset();
      const existing = { event_id: EVENT_ID, type: 'run.started' };
      pool.query
        .mockResolvedValueOnce({ rows: [RUN] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [existing] });

      const result = await HarnessEventService.emit({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        runId: RUN_ID,
        agentId: 9,
        type: 'run.started',
        requireRunOwnership: true,
      });

      expect(result.duplicate).toBe(true);
      expect(result.event).toEqual(existing);
      const duplicateCounter = await HarnessMetrics.counters.eventsDuplicates.get();
      expect(duplicateCounter.values[0].value).toBe(1);
    });

    it('rejects a timestamp too far in the future', async () => {
      pool.query.mockResolvedValueOnce({ rows: [RUN] });
      await expect(HarnessEventService.emit({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        runId: RUN_ID,
        agentId: 9,
        type: 'run.started',
        timestamp: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        requireRunOwnership: true,
      })).rejects.toThrow('timestamp must not be more than 5 minutes in the future');
    });

    it('rejects an invalid event timestamp', async () => {
      pool.query.mockResolvedValueOnce({ rows: [RUN] });
      await expect(HarnessEventService.emit({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        runId: RUN_ID,
        agentId: 9,
        type: 'run.started',
        timestamp: 'not-a-time',
        requireRunOwnership: true,
      })).rejects.toThrow('timestamp must be a valid timestamp');
    });

    it('rejects an event without a project when it has no run', async () => {
      await expect(HarnessEventService.emit({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        type: 'run.started',
      })).rejects.toThrow('projectId is required when the event has no run');
    });
  });

  describe('timeline', () => {
    it('orders events and extracts replay artifacts', async () => {
      const events = [
        {
          event_id: EVENT_ID,
          trace_id: TRACE_ID,
          type: 'prompt.sent',
          payload: { promptHash: 'abc', length: 120 },
        },
        {
          event_id: '44444444-4444-4444-8444-444444444444',
          trace_id: TRACE_ID,
          type: 'verification.result',
          payload: { command: 'npm test', exitCode: 1, timedOut: false },
        },
        {
          event_id: '55555555-5555-4555-8555-555555555555',
          trace_id: TRACE_ID,
          type: 'diff.collected',
          payload: { sha256: 'def', changedFiles: 2, changedBytes: 512 },
        },
      ];
      pool.query.mockResolvedValueOnce({ rows: events });

      const timeline = await HarnessEventService.getTimeline(RUN_ID);

      expect(timeline.events).toEqual(events);
      expect(timeline.verificationCommands).toEqual(['npm test']);
      expect(timeline.artifacts.map((a) => a.kind)).toEqual(
        ['verification', 'diff']
      );
      expect(timeline.replayable).toBe(true);
      expect(timeline.diff.changedBytes).toBe(512);
    });
  });

  describe('retention', () => {
    it('opts in to the purge guard and deletes normal and audit windows', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({ rowCount: 4 })
          .mockResolvedValueOnce({ rowCount: 1 })
          .mockResolvedValueOnce({}),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      const result = await HarnessEventService.purgeExpired({ eventDays: 30, auditDays: 365 });

      expect(result).toEqual({ events: 4, audit: 1, total: 5 });
      expect(client.query).toHaveBeenCalledWith(
        "SET LOCAL harness.allow_event_purge = 'on'"
      );
      expect(client.query.mock.calls[2][0]).toContain("type NOT LIKE 'audit.%'");
      expect(client.query.mock.calls[3][0]).toContain("type LIKE 'audit.%'");
      expect(client.release).toHaveBeenCalled();
    });

    it('rolls back and releases when retention fails', async () => {
      const client = {
        query: jest.fn()
          .mockResolvedValueOnce({})
          .mockResolvedValueOnce({})
          .mockRejectedValueOnce(new Error('denied'))
          .mockResolvedValueOnce({}),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      await expect(HarnessEventService.purgeExpired({})).rejects.toThrow('denied');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });
  });

  describe('audit listing', () => {
    it('queries audit types only', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ type: 'audit.publish' }] });
      const rows = await HarnessEventService.listAudit(7, {});
      expect(rows).toHaveLength(1);
      expect(pool.query.mock.calls[0][0]).toContain("type LIKE 'audit.%'");
    });
  });

  describe('ensureTerminalEvent', () => {
    it('synthesises a terminal event when the agent event was lost', async () => {
      const stored = { event_id: EVENT_ID, type: 'run.failed' };
      pool.query
        .mockResolvedValueOnce({ rows: [] }) // existing terminal event
        .mockResolvedValueOnce({ rows: [{ trace_id: TRACE_ID }] }) // trace
        .mockResolvedValueOnce({ rows: [RUN] }) // loadRun in ensureTerminalEvent
        .mockResolvedValueOnce({ rows: [RUN] }) // loadRun in emit
        .mockResolvedValueOnce({ rows: [stored] }); // insert

      const event = await HarnessEventService.ensureTerminalEvent({
        runId: RUN_ID,
        status: 'failed',
        error: 'boom',
      });

      expect(event).toEqual(stored);
    });

    it('does not duplicate an existing terminal event', async () => {
      const existing = { event_id: EVENT_ID, type: 'run.succeeded' };
      pool.query.mockResolvedValueOnce({ rows: [existing] });

      const event = await HarnessEventService.ensureTerminalEvent({
        runId: RUN_ID,
        status: 'succeeded',
      });

      expect(event).toEqual(existing);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });
  });
});
