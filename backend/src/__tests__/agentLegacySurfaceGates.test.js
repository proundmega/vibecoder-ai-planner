const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const HarnessEventService = require('../services/HarnessEventService');
const RepoProfileValidationService = require('../services/RepoProfileValidationService');

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
    ['runs', '/api/v1/harness/agents/3/runs'],
    ['workspaces', '/api/v1/harness/agents/3/workspaces'],
  ])('rejects node credentials on harness %s self routes', async (_name, path) => {
    const res = await request(app)
      .get(path)
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toMatch(/legacy agent endpoints/);
  });

  it('rejects node credentials on harness run writes until runtime_id lands', async () => {
    const res = await request(app)
      .post('/api/v1/harness/runs')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ ticketId: 1, branch: 'feature' });

    expect(res.statusCode).toBe(403);
    expect(res.body.error.message).toMatch(/legacy agent endpoints/);
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
      expect.objectContaining({ runId: RUN_ID, agentId: 3 })
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
