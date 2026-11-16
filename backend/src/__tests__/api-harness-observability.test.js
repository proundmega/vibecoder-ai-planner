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
  listRunsForProject: jest.fn(),
}));

jest.mock('../services/HarnessEventService', () => ({
  emit: jest.fn(),
  listForRun: jest.fn(),
  listForProject: jest.fn(),
  listAudit: jest.fn(),
  getTimeline: jest.fn(),
}));

jest.mock('../services/HarnessUsageService', () => ({
  recordUsage: jest.fn(),
  listForRun: jest.fn(),
  getRunTotals: jest.fn(),
  summarizeProject: jest.fn(),
}));

jest.mock('../services/HarnessBudgetService', () => ({
  getPolicy: jest.fn(),
  upsertPolicy: jest.fn(),
  getKillSwitch: jest.fn(),
  setKillSwitch: jest.fn(),
  listKillSwitchAudit: jest.fn(),
}));

jest.mock('../services/HarnessAuditService', () => ({
  recordReview: jest.fn(),
  recordPublish: jest.fn(),
}));

const HarnessRunService = require('../services/HarnessRunService');
const HarnessEventService = require('../services/HarnessEventService');
const HarnessUsageService = require('../services/HarnessUsageService');
const HarnessBudgetService = require('../services/HarnessBudgetService');
const HarnessAuditService = require('../services/HarnessAuditService');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const EVENT_ID = '22222222-2222-4222-8222-222222222222';
const TRACE_ID = '33333333-3333-4333-8333-333333333333';

const RUN = { id: RUN_ID, agent_id: 7, ticket_id: 42, project_id: 5 };

describe('Harness observability API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({
      userId: 'user-1', id: 'user-1', email: 'user@test.com', role: 'project_admin',
    });
    PermissionService.hasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
    HarnessRunService.getRun.mockResolvedValue(RUN);
    HarnessUsageService.listForRun.mockResolvedValue([]);
    HarnessUsageService.getRunTotals.mockResolvedValue({ inputTokens: 0 });
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

    it('audits review results', async () => {
      HarnessEventService.emit.mockResolvedValue({
        event: {
          event_id: EVENT_ID,
          type: 'review.result',
          run_id: RUN_ID,
          project_id: 5,
          ticket_id: 42,
          agent_id: 7,
          payload: { summary: 'changes requested' },
        },
        duplicate: false,
      });

      const res = await request(app)
        .post('/api/v1/harness/events')
        .set('X-API-Key', 'agent-key')
        .send({
          eventId: EVENT_ID, traceId: TRACE_ID, runId: RUN_ID, type: 'review.result',
        });

      expect(res.statusCode).toBe(201);
      expect(HarnessAuditService.recordReview).toHaveBeenCalledWith(
        expect.objectContaining({ runId: RUN_ID, projectId: 5, actorType: 'agent' })
      );
    });

    it('requires an agent key', async () => {
      const res = await request(app)
        .post('/api/v1/harness/events')
        .set('Authorization', 'Bearer mock-token')
        .send({ eventId: EVENT_ID, traceId: TRACE_ID, runId: RUN_ID, type: 'tool.called' });

      expect(res.statusCode).toBe(403);
    });
  });

  describe('run-scoped reads', () => {
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

    it('returns a replay timeline to a project member', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessEventService.getTimeline.mockResolvedValue({
        run: RUN, events: [], checkpoints: [], artifacts: [], replayable: true,
      });

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/timeline`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.replayable).toBe(true);
    });

    it('denies a JWT outside the project', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'other', is_member: false }],
      });
      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/events`)
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(403);
    });
  });

  describe('usage', () => {
    it('records a usage snapshot for the owning agent', async () => {
      HarnessUsageService.recordUsage.mockResolvedValue({ id: 'usage-1' });
      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/usage`)
        .set('X-API-Key', 'agent-key')
        .send({ model: 'gpt-4o', inputTokens: 100, outputTokens: 20, toolCalls: 2 });

      expect(res.statusCode).toBe(201);
      expect(HarnessUsageService.recordUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: RUN_ID, agentId: 7, model: 'gpt-4o', inputTokens: 100,
        })
      );
    });

    it('reads run usage for operators', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessUsageService.listForRun.mockResolvedValue([{ model: 'gpt-4o' }]);
      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/usage`)
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(200);
      expect(res.body.data.models).toHaveLength(1);
    });
  });

  describe('project policies and usage', () => {

    it('returns a project member the recent runs for replay', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessRunService.listRunsForProject.mockResolvedValue([
        { id: RUN_ID, status: 'failed' },
      ]);
      const res = await request(app)
        .get('/api/v1/harness/projects/5/runs?limit=10')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(HarnessRunService.listRunsForProject).toHaveBeenCalledWith(5, {
        limit: '10',
        since: undefined,
        until: undefined,
      });
    });

    it('returns the project policy to a member', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessBudgetService.getPolicy.mockResolvedValue({
        projectId: 5, limits: { maxCostUsd: 5 },
      });
      const res = await request(app)
        .get('/api/v1/harness/projects/5/budget-policy')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(200);
    });

    it('lets a project admin update the policy', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'user-1', is_member: false }],
      });
      HarnessBudgetService.getPolicy.mockResolvedValue({ projectId: 5 });
      const res = await request(app)
        .put('/api/v1/harness/projects/5/budget-policy')
        .set('Authorization', 'Bearer mock-token')
        .send({ maxCostUsd: 10, routingPolicy: 'free_only' });

      expect(res.statusCode).toBe(200);
      expect(HarnessBudgetService.upsertPolicy).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: 5, scope: 'project', updatedBy: 'user-1' })
      );
    });

    it('denies a plain member the policy write', async () => {
      jwt.verify.mockReturnValue({
        userId: 'user-2', id: 'user-2', email: 'm@test.com', role: 'member',
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      const res = await request(app)
        .put('/api/v1/harness/projects/5/budget-policy')
        .set('Authorization', 'Bearer mock-token')
        .send({ maxCostUsd: 10 });
      expect(res.statusCode).toBe(403);
      expect(HarnessBudgetService.upsertPolicy).not.toHaveBeenCalled();
    });

    it('lets a super_admin toggle the global kill switch', async () => {
      jwt.verify.mockReturnValue({
        userId: 'user-1', id: 'user-1', email: 'admin@test.com', role: 'super_admin',
      });
      HarnessBudgetService.setKillSwitch.mockResolvedValue({
        scope: 'global', enabled: true,
      });
      const res = await request(app)
        .put('/api/v1/harness/kill-switch')
        .set('Authorization', 'Bearer mock-token')
        .send({ enabled: true, reason: 'incident' });

      expect(res.statusCode).toBe(200);
      expect(HarnessBudgetService.setKillSwitch).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: null, enabled: true, reason: 'incident' })
      );
    });

    it('denies the global kill switch to a project admin', async () => {
      const res = await request(app)
        .put('/api/v1/harness/kill-switch')
        .set('Authorization', 'Bearer mock-token')
        .send({ enabled: true });
      expect(res.statusCode).toBe(403);
    });

    it('lets a project admin toggle a project kill switch', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'user-1', is_member: false }],
      });
      HarnessBudgetService.setKillSwitch.mockResolvedValue({
        scope: 'project', project_id: 5, enabled: true,
      });
      const res = await request(app)
        .put('/api/v1/harness/projects/5/kill-switch')
        .set('Authorization', 'Bearer mock-token')
        .send({ enabled: true, reason: 'cost spike' });
      expect(res.statusCode).toBe(200);
    });

    it('returns audit events for a member', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessEventService.listAudit.mockResolvedValue([{ type: 'audit.publish' }]);
      const res = await request(app)
        .get('/api/v1/harness/projects/5/audit')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('returns kill-switch history to a member', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'owner-1', is_member: true }],
      });
      HarnessBudgetService.listKillSwitchAudit.mockResolvedValue([
        { scope: 'project', enabled: true, reason: 'incident' },
      ]);
      const res = await request(app)
        .get('/api/v1/harness/projects/5/kill-switch/audit')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(HarnessBudgetService.listKillSwitchAudit).toHaveBeenCalledWith(5, {
        limit: undefined,
      });
    });

    it('rejects an invalid project id', async () => {
      const res = await request(app)
        .get('/api/v1/harness/projects/not-a-number/budget-policy')
        .set('Authorization', 'Bearer mock-token');
      expect(res.statusCode).toBe(400);
    });
  });
});
