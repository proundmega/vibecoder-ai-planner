const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const FixRequestService = require('../services/FixRequestService');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const Ticket = require('../models/ticket');
const TicketService = require('../services/TicketService');
const PermissionService = require('../services/PermissionService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
  transaction: jest.fn(),
}));

jest.mock('../services/FixRequestService', () => ({
  createOrEnsure: jest.fn(),
}));

const ATTEMPT_ID = '11111111-1111-4111-8111-111111111111';
let fixLoopMode = 'auto';

function mockReviewerRuntime() {
  jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
    status: 'ok',
    node: { id: 12, owner_id: 7 },
  });
  jest.spyOn(AgentNodeService, 'getRuntimeForNode').mockResolvedValue({
    id: 3,
    role: 'reviewer',
    status: 'running',
    current_project_id: 5,
  });
  pool.query.mockImplementation((sql) => {
    if (sql.includes('SELECT project_id FROM tickets')) {
      return Promise.resolve({ rows: [{ project_id: 5 }] });
    }
    if (sql.includes('FROM agent_node_grants')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    if (sql.includes('fix_loop_mode')) {
      return Promise.resolve({ rows: [{ fix_loop_mode: fixLoopMode }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe('POST /tickets/:id/review/request-changes (fg-32a)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fixLoopMode = 'auto';
    jwt.verify.mockReturnValue({ userId: 7, role: 'member' });
    jest.spyOn(PermissionService, 'hasAnyPermission').mockResolvedValue(true);
    jest.spyOn(Ticket, 'findById').mockResolvedValue({
      id: 42,
      projectId: 5,
      ownerId: 1,
    });
    jest.spyOn(TicketService, 'canActOnTicketProject').mockResolvedValue(true);
    mockReviewerRuntime();
  });

  it('creates a request for a reviewer agent', async () => {
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: true,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(201);
    expect(response.body).toEqual({
      success: true,
      data: { id: 'req-1', state: 'queued' },
    });
    expect(FixRequestService.createOrEnsure).toHaveBeenCalledWith(
      '42',
      { attemptId: ATTEMPT_ID, feedback: null },
      { actorId: 3 }
    );
  });

  it('rejects a human who is not a member of the ticket project', async () => {
    TicketService.canActOnTicketProject.mockResolvedValue(false);

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(403);
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('allows a member JWT and passes the numeric user id as the actor', async () => {
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: true,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(201);
    expect(FixRequestService.createOrEnsure).toHaveBeenCalledWith(
      '42',
      { attemptId: null, feedback: 'Please fix this' },
      { actorId: 7 }
    );
  });

  it('rejects a malformed human ticket id before membership lookup', async () => {
    const response = await request(app)
      .post('/api/v1/tickets/abc/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(400);
    expect(Ticket.findById).not.toHaveBeenCalled();
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('rejects a legacy agent key without a runtime', async () => {
    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'test-reviewer')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('RUNTIME_REQUIRED');
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('rejects manual feedback from an agent', async () => {
    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(400);
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('returns the existing request with 200', async () => {
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: false,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.id).toBe('req-1');
  });

  it('refuses a reviewer agent unless dispatch is automatic', async () => {
    fixLoopMode = 'manual';

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(409);
    expect(response.body.error.message)
      .toContain('Automatic fix dispatch requires FIX_LOOP_MODE=auto');
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('refuses every source when the loop is off', async () => {
    fixLoopMode = 'off';

    const human = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(human.statusCode).toBe(409);
    expect(human.body.error.message).toContain('Fix loop is disabled for this project');
    expect(FixRequestService.createOrEnsure).not.toHaveBeenCalled();
  });

  it('allows a human in manual mode', async () => {
    fixLoopMode = 'manual';
    FixRequestService.createOrEnsure.mockResolvedValue({
      created: true,
      request: { id: 'req-1', state: 'queued' },
    });

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('Authorization', 'Bearer mock-token')
      .send({ feedback: 'Please fix this' });

    expect(response.statusCode).toBe(201);
    expect(FixRequestService.createOrEnsure).toHaveBeenCalledWith(
      '42',
      { attemptId: null, feedback: 'Please fix this' },
      { actorId: 7 }
    );
  });

  it('maps a service conflict to 409', async () => {
    const { ConflictError } = require('../errors/HttpError');
    FixRequestService.createOrEnsure.mockRejectedValue(
      new ConflictError('Review attempt did not request changes'));

    const response = await request(app)
      .post('/api/v1/tickets/42/review/request-changes')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3')
      .send({ attempt_id: ATTEMPT_ID });

    expect(response.statusCode).toBe(409);
    expect(response.body.success).toBe(false);
  });
});
