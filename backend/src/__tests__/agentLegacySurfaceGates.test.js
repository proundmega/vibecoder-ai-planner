const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const HarnessEventService = require('../services/HarnessEventService');

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
});
