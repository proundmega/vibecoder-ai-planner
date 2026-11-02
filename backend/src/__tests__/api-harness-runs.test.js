const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

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
  startRun: jest.fn(),
  getRun: jest.fn(),
  getCheckpoints: jest.fn(),
  recordCheckpoint: jest.fn(),
  heartbeat: jest.fn(),
  finishRun: jest.fn(),
  getLatestRunForTicket: jest.fn(),
  claimLease: jest.fn(),
  renewLease: jest.fn(),
  releaseLease: jest.fn(),
  listActiveRunsForAgent: jest.fn(),
  recordPublish: jest.fn(),
  releaseTicketForRun: jest.fn(),
  reconcileRun: jest.fn(),
}));

const HarnessRunService = require('../services/HarnessRunService');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

const RUN_ID = '11111111-1111-4111-8111-111111111111';

describe('Harness run API', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({
      userId: 'user-1', id: 'user-1', email: 'user@test.com', role: 'project_admin',
    });
    PermissionService.hasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
  });

  describe('POST /api/v1/harness/runs', () => {
    it('starts a run for the authenticated agent', async () => {
      HarnessRunService.startRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });

      const res = await request(app)
        .post('/api/v1/harness/runs')
        .set('X-API-Key', 'agent-key')
        .send({ ticketId: 42, branch: 'feat/fg-33', provider: 'anthropic', model: 'claude' });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(RUN_ID);
      expect(HarnessRunService.startRun).toHaveBeenCalledWith(
        expect.objectContaining({
          ticketId: 42,
          agentId: 7,
          branch: 'feat/fg-33',
          provider: 'anthropic',
          model: 'claude',
        })
      );
    });

    it('rejects a JWT caller because runs are agent-owned', async () => {
      const res = await request(app)
        .post('/api/v1/harness/runs')
        .set('Authorization', 'Bearer mock-token')
        .send({ ticketId: 42, branch: 'feat/fg-33' });

      expect(res.statusCode).toBe(403);
      expect(HarnessRunService.startRun).not.toHaveBeenCalled();
    });

    it('requires authentication', async () => {
      const res = await request(app)
        .post('/api/v1/harness/runs')
        .send({ ticketId: 42, branch: 'feat/fg-33' });

      expect(res.statusCode).toBe(401);
    });
  });

  describe('run ownership', () => {
    it('allows an agent to read its own run', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}`)
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(200);
    });

    it('blocks an agent from reading another agent\u2019s run', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 8 });

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}`)
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(403);
    });

    it('allows an operator JWT to read a run in their project', async () => {
      HarnessRunService.getRun.mockResolvedValue({
        id: RUN_ID, agent_id: 8, ticket_id: 42,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'user-1', is_member: false }],
      });

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
    });

    it('denies a JWT without AGENT_READ', async () => {
      HarnessRunService.getRun.mockResolvedValue({
        id: RUN_ID, agent_id: 8, ticket_id: 42,
      });
      PermissionService.hasPermission.mockResolvedValue(false);

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(403);
    });

    it('denies the user role even though the seed grants AGENT_READ', async () => {
      HarnessRunService.getRun.mockResolvedValue({
        id: RUN_ID, agent_id: 8, ticket_id: 42,
      });
      jwt.verify.mockReturnValue({
        userId: 'user-1', email: 'agent-user@test.com', role: 'user',
      });
      PermissionService.hasPermission.mockResolvedValue(true);

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(403);
    });

    it('denies a JWT outside the ticket project', async () => {
      HarnessRunService.getRun.mockResolvedValue({
        id: RUN_ID, agent_id: 8, ticket_id: 42,
      });
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'other-user', is_member: false }],
      });

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(403);
    });
  });

  describe('checkpoints', () => {
    it('records a checkpoint for the owning agent', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.recordCheckpoint.mockResolvedValue({ id: 'cp-1', step: 'cloned' });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/checkpoints`)
        .set('X-API-Key', 'agent-key')
        .send({ step: 'cloned', payload: { baseSha: 'abc' } });

      expect(res.statusCode).toBe(201);
      expect(HarnessRunService.recordCheckpoint).toHaveBeenCalledWith(
        RUN_ID,
        'cloned',
        { baseSha: 'abc' }
      );
    });

    it('rejects checkpoint writes from a JWT caller', async () => {
      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/checkpoints`)
        .set('Authorization', 'Bearer mock-token')
        .send({ step: 'cloned' });

      expect(res.statusCode).toBe(403);
      expect(HarnessRunService.recordCheckpoint).not.toHaveBeenCalled();
    });

    it('lists checkpoints for operators', async () => {
      HarnessRunService.getRun.mockResolvedValue({
        id: RUN_ID, agent_id: 8, ticket_id: 42,
      });
      HarnessRunService.getCheckpoints.mockResolvedValue([{ step: 'created' }]);
      pool.query.mockResolvedValueOnce({
        rows: [{ owner_id: 'user-1', is_member: false }],
      });

      const res = await request(app)
        .get(`/api/v1/harness/runs/${RUN_ID}/checkpoints`)
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });
  });

  describe('heartbeat and finish', () => {
    it('records a heartbeat for the authenticated agent', async () => {
      HarnessRunService.heartbeat.mockResolvedValue({ id: RUN_ID, step: 'verifying' });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/heartbeat`)
        .set('X-API-Key', 'agent-key')
        .send({ step: 'verifying' });

      expect(res.statusCode).toBe(200);
      expect(HarnessRunService.heartbeat).toHaveBeenCalledWith(RUN_ID, 7, 'verifying');
    });

    it('finishes a run owned by the agent', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.finishRun.mockResolvedValue({ id: RUN_ID, status: 'succeeded' });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/finish`)
        .set('X-API-Key', 'agent-key')
        .send({ status: 'succeeded', prUrl: 'https://github.com/o/r/pull/1' });

      expect(res.statusCode).toBe(200);
      expect(HarnessRunService.finishRun).toHaveBeenCalledWith(RUN_ID, {
        status: 'succeeded',
        error: undefined,
        headSha: undefined,
        prUrl: 'https://github.com/o/r/pull/1',
      });
    });

    it('blocks finishing another agent\u2019s run', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 8 });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/finish`)
        .set('X-API-Key', 'agent-key')
        .send({ status: 'succeeded' });

      expect(res.statusCode).toBe(403);
      expect(HarnessRunService.finishRun).not.toHaveBeenCalled();
    });
  });

  describe('leases', () => {
    it('returns 201 when a lease is claimed', async () => {
      HarnessRunService.claimLease.mockResolvedValue({ ticket_id: 42, run_id: RUN_ID });

      const res = await request(app)
        .post('/api/v1/harness/leases')
        .set('X-API-Key', 'agent-key')
        .send({ ticketId: 42, runId: RUN_ID, ttlSeconds: 120 });

      expect(res.statusCode).toBe(201);
      expect(HarnessRunService.claimLease).toHaveBeenCalledWith({
        ticketId: 42,
        runId: RUN_ID,
        agentId: 7,
        ttlSeconds: 120,
      });
    });

    it('returns 409 when the ticket is already leased', async () => {
      HarnessRunService.claimLease.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/harness/leases')
        .set('X-API-Key', 'agent-key')
        .send({ ticketId: 42, runId: RUN_ID });

      expect(res.statusCode).toBe(409);
    });

    it('renews a lease', async () => {
      HarnessRunService.renewLease.mockResolvedValue({ ticket_id: 42 });

      const res = await request(app)
        .post('/api/v1/harness/leases/42/renew')
        .set('X-API-Key', 'agent-key')
        .send({ runId: RUN_ID, ttlSeconds: 120 });

      expect(res.statusCode).toBe(200);
      expect(HarnessRunService.renewLease).toHaveBeenCalledWith({
        ticketId: '42',
        runId: RUN_ID,
        agentId: 7,
        ttlSeconds: 120,
      });
    });

    it('returns 409 when renewing a lost lease', async () => {
      HarnessRunService.renewLease.mockResolvedValue(null);

      const res = await request(app)
        .post('/api/v1/harness/leases/42/renew')
        .set('X-API-Key', 'agent-key')
        .send({ runId: RUN_ID });

      expect(res.statusCode).toBe(409);
    });

    it('releases an owned lease', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.releaseLease.mockResolvedValue(true);

      const res = await request(app)
        .delete('/api/v1/harness/leases/42')
        .set('X-API-Key', 'agent-key')
        .send({ runId: RUN_ID });

      expect(res.statusCode).toBe(200);
      expect(HarnessRunService.releaseLease).toHaveBeenCalledWith('42', RUN_ID);
    });

    it('returns 404 when there is no lease to release', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.releaseLease.mockResolvedValue(false);

      const res = await request(app)
        .delete('/api/v1/harness/leases/42')
        .set('X-API-Key', 'agent-key')
        .send({ runId: RUN_ID });

      expect(res.statusCode).toBe(404);
    });
  });

  describe('startup recovery endpoints', () => {
    it('lists active runs for the authenticated agent only', async () => {
      HarnessRunService.listActiveRunsForAgent.mockResolvedValue([
        { id: RUN_ID, status: 'running' },
      ]);

      const res = await request(app)
        .get('/api/v1/harness/agents/7/runs')
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual([{ id: RUN_ID, status: 'running' }]);
      expect(HarnessRunService.listActiveRunsForAgent).toHaveBeenCalledWith(7);
    });

    it('refuses to list another agent\u2019s runs', async () => {
      const res = await request(app)
        .get('/api/v1/harness/agents/8/runs')
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(403);
      expect(HarnessRunService.listActiveRunsForAgent).not.toHaveBeenCalled();
    });

    it('records publish evidence for the owning agent', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.recordPublish.mockResolvedValue({ id: RUN_ID, head_sha: 'abc123' });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/publish`)
        .set('X-API-Key', 'agent-key')
        .send({ headSha: 'abc123' });

      expect(res.statusCode).toBe(200);
      expect(HarnessRunService.recordPublish).toHaveBeenCalledWith(
        RUN_ID, 7, { headSha: 'abc123', prUrl: undefined }
      );
    });

    it('releases a ticket through the guarded run-bound path', async () => {
      HarnessRunService.releaseTicketForRun.mockResolvedValue({ id: 42 });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/release-ticket`)
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ released: true });
      expect(HarnessRunService.releaseTicketForRun).toHaveBeenCalledWith(
        RUN_ID, { agentId: 7 }
      );
    });

    it('reconciles a terminal run through the agent-scoped route', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.reconcileRun.mockResolvedValue({
        run_id: RUN_ID, ticket_id: 42, adopted: true, released: false, marked: true,
      });

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/reconcile`)
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.adopted).toBe(true);
      expect(HarnessRunService.reconcileRun).toHaveBeenCalledWith(RUN_ID);
    });

    it('refuses reconcile when the run is still active', async () => {
      HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, agent_id: 7 });
      HarnessRunService.reconcileRun.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/reconcile`)
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(409);
    });

    it('reports released=false when the guard refuses', async () => {
      HarnessRunService.releaseTicketForRun.mockResolvedValue(null);

      const res = await request(app)
        .post(`/api/v1/harness/runs/${RUN_ID}/release-ticket`)
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(200);
      expect(res.body.data).toEqual({ released: false });
    });
  });

  describe('GET /api/v1/harness/tickets/:ticketId/run', () => {
    it('returns the latest run', async () => {
      HarnessRunService.getLatestRunForTicket.mockResolvedValue({ id: RUN_ID, agent_id: 7 });

      const res = await request(app)
        .get('/api/v1/harness/tickets/42/run')
        .set('X-API-Key', 'agent-key');

      expect(res.statusCode).toBe(200);
      expect(res.body.data.id).toBe(RUN_ID);
    });

    it('returns 404 when the ticket has no run', async () => {
      HarnessRunService.getLatestRunForTicket.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/v1/harness/tickets/42/run')
        .set('Authorization', 'Bearer mock-token');

      expect(res.statusCode).toBe(404);
    });
  });
});
