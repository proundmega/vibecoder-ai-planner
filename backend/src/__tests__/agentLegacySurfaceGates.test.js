const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const HarnessEventService = require('../services/HarnessEventService');
const RepoProfileValidationService = require('../services/RepoProfileValidationService');
const HarnessRunService = require('../services/HarnessRunService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('../services/HarnessEventService', () => ({
  emit: jest.fn(),
  listForRun: jest.fn(),
  getTimeline: jest.fn(),
}));

jest.mock('../services/HarnessAuditService', () => ({
  recordReview: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/RepoProfileValidationService', () => ({
  claimNext: jest.fn(),
  finish: jest.fn(),
}));

jest.mock('../services/HarnessRunService', () => ({
  startRun: jest.fn(),
  getRun: jest.fn(),
  getLatestRunForTicket: jest.fn(),
  listActiveRunsForActor: jest.fn(),
  listActiveRunsForAgent: jest.fn(),
  listActiveWorkspacePathsForActor: jest.fn(),
  listActiveWorkspacePaths: jest.fn(),
  claimLease: jest.fn(),
  renewLease: jest.fn(),
  releaseLease: jest.fn(),
  recordPublish: jest.fn(),
  recordCheckpoint: jest.fn(),
  heartbeat: jest.fn(),
  finishRun: jest.fn(),
  releaseTicketForRun: jest.fn(),
  reconcileRun: jest.fn(),
  getCheckpoints: jest.fn(),
}));

const NODE = { id: 12, owner_id: 7 };
const RUN_ID = 'aaaaaaaa-1111-4111-8111-111111111111';

function mockRuntime(overrides = {}) {
  jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
    status: 'ok',
    node: NODE,
  });
  jest.spyOn(AgentNodeService, 'getRuntimeForNode').mockResolvedValue({
    id: 3,
    role: 'worker',
    status: 'running',
    current_project_id: 5,
    ...overrides,
  });
}

describe('legacy surface gates for node credentials (B5-B9)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
    mockRuntime();
  });

  afterEach(() => jest.restoreAllMocks());

  it('rejects node credentials on the legacy heartbeat route', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: NODE,
    });

    const res = await request(app)
      .post('/api/v1/agents-status/42/heartbeat')
      .set('X-API-Key', 'at_valid')
      .send({ current_step: 'working' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toMatch(/legacy agent heartbeat/);
  });

  it('rejects node credentials on legacy usage logging', async () => {
    const res = await request(app)
      .post('/api/v1/usage/agents/3/usage')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ provider_type: 'openai', model: 'm', tokens_in: 1, tokens_out: 1 });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toMatch(/legacy agent endpoints/);
  });

  it.each([
    ['runs', '/api/v1/harness/agents/3/runs', 'listActiveRunsForActor'],
    ['workspaces', '/api/v1/harness/agents/3/workspaces', 'listActiveWorkspacePathsForActor'],
  ])('allows a granted reviewer to list harness %s for its runtime', async (_name, path, method) => {
    mockRuntime({ role: 'reviewer' });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessRunService[method].mockResolvedValue([]);

    const res = await request(app)
      .get(path)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(res.statusCode).toBe(200);
    expect(HarnessRunService[method]).toHaveBeenCalledWith({ runtimeId: 3 });
  });

  it('starts a run for a granted worker runtime', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM tickets')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessRunService.startRun.mockResolvedValue({
      id: RUN_ID,
      ticket_id: 1,
      project_id: 5,
      runtime_id: 3,
      budget_policy: { source: 'test' },
    });

    const res = await request(app)
      .post('/api/v1/harness/runs')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ ticketId: 1, branch: 'feature' });

    expect(res.statusCode).toBe(201);
    expect(HarnessRunService.startRun).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 1, runtimeId: 3 })
    );
  });


  it('claims a lease for a granted worker runtime', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM tickets')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessRunService.claimLease.mockResolvedValue({
      ticket_id: 1, run_id: RUN_ID, runtime_id: 3,
    });

    const res = await request(app)
      .post('/api/v1/harness/leases')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ ticketId: 1, runId: RUN_ID, ttlSeconds: 60 });

    expect(res.statusCode).toBe(201);
    expect(HarnessRunService.claimLease).toHaveBeenCalledWith(
      expect.objectContaining({ ticketId: 1, runId: RUN_ID, runtimeId: 3 })
    );
  });

  it('records a heartbeat for a runtime owner', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM harness_runs')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessRunService.heartbeat.mockResolvedValue({ id: RUN_ID, runtime_id: 3 });

    const res = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/heartbeat`)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ step: 'verifying' });

    expect(res.statusCode).toBe(200);
    expect(HarnessRunService.heartbeat).toHaveBeenCalledWith(
      RUN_ID, { runtimeId: 3 }, 'verifying'
    );
  });

  it('lets a granted reviewer read a runtime-owned run', async () => {
    mockRuntime({ role: 'reviewer' });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM harness_runs')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessRunService.getRun.mockResolvedValue({
      id: RUN_ID, ticket_id: 1, project_id: 5, agent_id: null, runtime_id: 99,
    });

    const res = await request(app)
      .get(`/api/v1/harness/runs/${RUN_ID}`)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(res.statusCode).toBe(200);
    expect(res.body.data.runtime_id).toBe(99);
  });

  it('denies a worker publishing another runtime-owned run', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM harness_runs')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessRunService.getRun.mockResolvedValue({
      id: RUN_ID, ticket_id: 1, project_id: 5, agent_id: null, runtime_id: 99,
    });

    const res = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/publish`)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ headSha: 'abc123' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toMatch(/another agent/);
  });

  it('requires an active grant for non-review harness events', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM harness_runs')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/harness/events')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ type: 'run.started', runId: RUN_ID });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('GRANT_REQUIRED');
    expect(HarnessEventService.emit).not.toHaveBeenCalled();
  });

  it('accepts a granted non-review harness event', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM harness_runs')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessEventService.emit.mockResolvedValue({
      duplicate: false,
      event: { type: 'run.started', event_id: 'eeeeeeee-1111-4111-8111-111111111111' },
    });

    const res = await request(app)
      .post('/api/v1/harness/events')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ type: 'run.started', runId: RUN_ID });

    expect(res.statusCode).toBe(201);
    expect(HarnessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, runtimeId: 3 })
    );
  });

  it('denies a reviewer runtime a write-capable GitHub token', async () => {
    mockRuntime({ role: 'reviewer' });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/github/5/token')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ operation: 'agent' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('denies a stopped worker runtime a GitHub token', async () => {
    mockRuntime({ status: 'stopped' });

    const res = await request(app)
      .post('/api/v1/github/5/token')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ operation: 'agent' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('RUNTIME_INACTIVE');
  });

  it('denies a worker without a GitHub project grant', async () => {
    pool.query.mockImplementation(() => Promise.resolve({ rows: [] }));

    const res = await request(app)
      .post('/api/v1/github/5/token')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ operation: 'agent' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('GRANT_REQUIRED');
  });

  it('accepts a documented runId-only review event from a granted reviewer', async () => {
    mockRuntime({ role: 'reviewer' });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM harness_runs')) {
        return Promise.resolve({ rows: [{ project_id: 5 }] });
      }
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    HarnessEventService.emit.mockResolvedValue({
      duplicate: false,
      event: {
        type: 'review.result',
        event_id: 'bbbbbbbb-1111-4111-8111-111111111111',
        run_id: RUN_ID,
        project_id: 5,
        ticket_id: 1,
        agent_id: 3,
        payload: { summary: 'looks good' },
      },
    });

    const res = await request(app)
      .post('/api/v1/harness/events')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({
        eventId: 'bbbbbbbb-1111-4111-8111-111111111111',
        traceId: 'cccccccc-1111-4111-8111-111111111111',
        runId: RUN_ID,
        type: 'review.result',
        payload: { summary: 'looks good' },
      });

    expect(res.statusCode).toBe(201);
    expect(HarnessEventService.emit).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, runtimeId: 3 })
    );
  });
  it.each([
    ['status', 'post', '/api/v1/tickets/1/status', { status: 'done' }],
    ['update', 'put', '/api/v1/tickets/1', { status: 'done' }],
    ['phase transition', 'post', '/api/v1/tickets/1/phases/transition', { toPhase: 'execution' }],
    ['ticket create', 'post', '/api/v1/tickets', { projectId: 5, title: 't' }],
    ['project ticket create', 'post', '/api/v1/projects/5/tickets', { title: 't' }],
  ])('denies a reviewer runtime on ticket %s', async (_name, method, path, body) => {
    mockRuntime({ role: 'reviewer' });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM tickets')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)[method](path)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send(body);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('blocks a worker phase transition that would complete the ticket', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM tickets')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/tickets/1/phases/transition')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ toPhase: 'done' });

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe('INVALID_STATUS');
  });

  it('denies a stopped worker on a ticket status change', async () => {
    mockRuntime({ status: 'stopped' });

    const res = await request(app)
      .post('/api/v1/tickets/1/status')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ status: 'done' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('RUNTIME_INACTIVE');
  });

  it('denies a reviewer runtime on repo-profile validation claim, finish and mTLS', async () => {
    mockRuntime({ role: 'reviewer' });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    const validationId = 'dddddddd-1111-4111-8111-111111111111';

    const claim = await request(app)
      .post('/api/v1/projects/5/repo-profile/validations/claim')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');
    expect(claim.statusCode).toBe(403);
    expect(claim.body.error.code).toBe('FORBIDDEN');

    const finish = await request(app)
      .post(`/api/v1/projects/5/repo-profile/validations/${validationId}/finish`)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ status: 'succeeded' });
    expect(finish.statusCode).toBe(403);
    expect(finish.body.error.code).toBe('FORBIDDEN');

    const mtls = await request(app)
      .get(`/api/v1/projects/5/repo-profile/agent/mtls?profileId=${validationId}&profileVersion=1`)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');
    expect(mtls.statusCode).toBe(403);
    expect(mtls.body.error.code).toBe('FORBIDDEN');
  });

  it('passes the runtime id to repo-profile validation claim for a granted worker', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    RepoProfileValidationService.claimNext.mockResolvedValue({ id: 'v1', status: 'running' });

    const res = await request(app)
      .post('/api/v1/projects/5/repo-profile/validations/claim')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(res.statusCode).toBe(200);
    expect(RepoProfileValidationService.claimNext).toHaveBeenCalledWith(
      '5', expect.objectContaining({ id: 3, _node: true }), 3
    );
  });

  it('passes the runtime id to repo-profile validation finish for a granted worker', async () => {
    pool.query.mockImplementation((sql) => {
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    RepoProfileValidationService.finish.mockResolvedValue({ id: 'v1', status: 'succeeded' });
    const validationId = 'dddddddd-1111-4111-8111-111111111111';

    const res = await request(app)
      .post(`/api/v1/projects/5/repo-profile/validations/${validationId}/finish`)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ status: 'succeeded' });

    expect(res.statusCode).toBe(200);
    expect(RepoProfileValidationService.finish).toHaveBeenCalledWith(
      '5', validationId, expect.objectContaining({ id: 3, _node: true }),
      { status: 'succeeded' }, 3
    );
  });
});
