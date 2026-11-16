const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/AgentService', () => ({
  getAgentByApiKey: jest.fn().mockResolvedValue({ id: 7, owner_id: 1 }),
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/HarnessRunService', () => ({
  getRun: jest.fn(),
}));

jest.mock('../services/HarnessEventService', () => ({
  emit: jest.fn(),
  listForRun: jest.fn(),
  listForProject: jest.fn(),
}));

const HarnessRunService = require('../services/HarnessRunService');
const HarnessEventService = require('../services/HarnessEventService');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';

const RUN = { id: RUN_ID, agent_id: 7, ticket_id: 42, project_id: 5 };

describe('Harness event API (fg-41 slice 1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({
      userId: 'user-1', id: 'user-1', email: 'user@test.com', role: 'project_admin',
    });
    PermissionService.hasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
    HarnessRunService.getRun.mockResolvedValue(RUN);
  });

  describe('POST /harness/events', () => {
    it('appends an agent event', async () => {
      HarnessEventService.emit.mockResolvedValue({
        event: { event_id: EVENT_ID, type: 'tool.called', run_id: RUN_ID },
        duplicate: false,
      });

      const res = await request(app)
        .post('/api/v1/harness/events')
        .set('X-API-Key', 'agent-key')
        .send({
          eventId: EVENT_ID,
          traceId: TRACE_ID,
          runId: RUN_ID,
          type: 'tool.called',
          payload: { tool: 'bash' },
        });

      expect(res.statusCode).toBe(201);
      expect(HarnessEventService.emit).toHaveBeenCalledWith(expect.objectContaining({
        eventId: EVENT_ID,
        traceId: TRACE_ID,
        runId: RUN_ID,
        agentId: 7,
        type: 'tool.called',
        requireRunOwnership: true,
      }));
    });

    it('returns 200 for an idempotent duplicate', async () => {
      HarnessEventService.emit.mockResolvedValue({
        event: { event_id: EVENT_ID, type: 'tool.called' },
        duplicate: true,
      });

      const res = await request(app)
        .post('/api/v1/harness/events')
        .set('X-API-Key', 'agent-key')
        .send({
          eventId: EVENT_ID, traceId: TRACE_ID, runId: RUN_ID, type: 'tool.called',
        });

      expect(res.statusCode).toBe(200);
    });

    it('refuses agent-authored audit events', async () => {
      const res = await request(app)
        .post('/api/v1/harness/events')
        .set('X-API-Key', 'agent-key')
        .send({
          eventId: EVENT_ID, traceId: TRACE_ID, runId: RUN_ID, type: 'audit.publish',
        });

      expect(res.statusCode).toBe(403);
      expect(HarnessEventService.emit).not.toHaveBeenCalled();
    });

    it('requires an agent key', async () => {
      const res = await request(app)
        .post('/api/v1/harness/events')
        .set('Authorization', 'Bearer mock-token')
        .send({ eventId: EVENT_ID, traceId: TRACE_ID, runId: RUN_ID, type: 'tool.called' });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('run-scoped and project-scoped reads', () => {
    it('lets the owning agent read events', async () => {
      HarnessEventService.listForRun.mockResolvedValue([{ event_id: EVENT_ID }]);
      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/events`)
        .set('X-API-Key', 'agent-key');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('blocks an agent from reading another agent’s events', async () => {
      HarnessRunService.getRun.mockResolvedValue({ ...RUN, agent_id: 8 });
      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/events`)
        .set('X-API-Key', 'agent-key');
      expect(res.statusCode).toBe(403);
    });

<<<<<<< HEAD
<<<<<<< HEAD
=======
>>>>>>> c0eee13 (fix(fg-41): renumber migrations and close review blocking gaps)
    it('falls back to the ticket project when an older run has no project_id', async () => {
      HarnessRunService.getRun.mockResolvedValue({
        ...RUN, project_id: null,
      });
      pool.query
        .mockResolvedValueOnce({ rows: [{ project_id: 5 }] })
        .mockResolvedValueOnce({ rows: [{ owner_id: 'owner-1', is_member: true }] });
      HarnessEventService.listForRun.mockResolvedValue([{ event_id: EVENT_ID }]);

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/events`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

<<<<<<< HEAD
=======
>>>>>>> 8422e0f (feat(fg-41): append-only harness event stream, sink and redaction)
=======
>>>>>>> c0eee13 (fix(fg-41): renumber migrations and close review blocking gaps)
    it('returns project events to a member', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessEventService.listForProject.mockResolvedValue([{ event_id: EVENT_ID }]);
      const res = await request(app)
        .get('/api/v1/harness/projects/5/events')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('denies a JWT outside the project', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'other', is_member: false }],
      });
      const res = await request(app)
        .get('/api/v1/harness/projects/5/events')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(403);
    });

    it('rejects an invalid project id', async () => {
      const res = await request(app)
        .get('/api/v1/harness/projects/not-a-number/events')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(400);
    });
  });
});
