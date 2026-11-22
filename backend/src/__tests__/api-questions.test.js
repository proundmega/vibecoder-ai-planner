const request = require('supertest');
const app = require('../index');

jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

jest.mock('../middleware/auth', () => {
  const actual = jest.requireActual('../middleware/auth');
  return {
    ...actual,
    verifyTokenOrAgent: (req, res, next) => {
      if (req.headers.authorization) {
        return actual.verifyToken(req, res, next);
      }
      if (!req.headers['x-api-key']) {
        return res.status(401).json({
          success: false,
          error: { code: 'UNAUTHORIZED', message: 'Missing authentication token' },
        });
      }
      req.agent = {
        id: 3, owner_id: 7, project_id: 5, _node: true, _nodeRecord: { id: 12 },
      };
      req.node = { id: 12 };
      req.runtime = {
        id: Number(req.headers['x-test-runtime'] || 3),
        role: 'worker',
        status: 'running',
        current_project_id: 5,
      };
      req.user = { userId: '7', id: 3, role: 'member' };
      return next();
    },
  };
});

jest.mock('../middleware/agentRole', () => {
  const actual = jest.requireActual('../middleware/agentRole');
  const pass = () => (req, res, next) => next();
  return {
    ...actual,
    requireRuntime: pass,
    requireRole: pass,
    requireBodyGrant: pass,
    requireRunGrant: pass,
    requireTicketGrant: pass,
    requireProjectGrant: pass,
  };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: '1', id: 1, email: 'user@test.com', role: 'member' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/TicketQuestionService', () => ({
  createForRun: jest.fn(),
  getForRun: jest.fn(),
  listForRun: jest.fn(),
  listForTicket: jest.fn(),
  listForProject: jest.fn(),
  listForUser: jest.fn(),
  answer: jest.fn(),
  expire: jest.fn(),
  expirePendingForRun: jest.fn(),
}));

jest.mock('../services/HarnessRunService', () => ({
  getRun: jest.fn(),
}));

jest.mock('../services/NotificationService', () => ({
  listForUser: jest.fn(),
  unreadCount: jest.fn(),
  markRead: jest.fn(),
  markAllRead: jest.fn(),
  createForQuestion: jest.fn(),
  createForRunFinish: jest.fn(),
  markQuestionRead: jest.fn(),
}));

const TicketQuestionService = require('../services/TicketQuestionService');
const HarnessRunService = require('../services/HarnessRunService');
const NotificationService = require('../services/NotificationService');
const PermissionService = require('../services/PermissionService');
const { ConflictError } = require('../errors/HttpError');
const { pool } = require('../db');
const jwt = require('jsonwebtoken');

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION = {
  id: 7,
  run_id: RUN_ID,
  ticket_id: 42,
  project_id: 5,
  runtime_id: 3,
  kind: 'question',
  status: 'pending',
  prompt: 'Which helper?',
  answer: null,
  answered_at: null,
  expires_at: null,
};

describe('Question and notification API (fg-55)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({
      userId: '1', id: 1, email: 'user@test.com', role: 'member',
    });
    PermissionService.hasPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
    NotificationService.unreadCount.mockResolvedValue(3);
    HarnessRunService.getRun.mockResolvedValue({ id: RUN_ID, runtime_id: 3 });
  });

  it('agent creates, reads and expires a question for its own run', async () => {
    TicketQuestionService.createForRun.mockResolvedValue(QUESTION);
    TicketQuestionService.getForRun.mockResolvedValue(QUESTION);
    TicketQuestionService.expire.mockResolvedValue({ ...QUESTION, status: 'expired' });

    const created = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions`)
      .set('X-API-Key', 'agent-key')
      .send({ kind: 'question', externalId: 'evt_1', prompt: 'Which helper?' });

    expect(created.statusCode).toBe(201);
    expect(created.body.data).toEqual({
      id: 7, status: 'pending', expiresAt: null,
    });
    expect(TicketQuestionService.createForRun).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, runtimeId: 3, externalId: 'evt_1' })
    );

    const read = await request(app)
      .get(`/api/v1/harness/runs/${RUN_ID}/questions/7`)
      .set('X-API-Key', 'agent-key');
    expect(read.statusCode).toBe(200);
    expect(read.body.data.status).toBe('pending');

    const expired = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions/7/expire`)
      .set('X-API-Key', 'agent-key')
      .send({});
    expect(expired.statusCode).toBe(200);
    expect(expired.body.data.status).toBe('expired');
  });

  it('a second worker in the same project cannot read another runtime’s questions', async () => {
    TicketQuestionService.getForRun.mockResolvedValue(QUESTION);
    TicketQuestionService.listForRun.mockResolvedValue([QUESTION]);

    const list = await request(app)
      .get(`/api/v1/harness/runs/${RUN_ID}/questions`)
      .set('X-API-Key', 'agent-key')
      .set('X-Test-Runtime', '4');
    expect(list.statusCode).toBe(403);
    expect(TicketQuestionService.listForRun).not.toHaveBeenCalled();

    const read = await request(app)
      .get(`/api/v1/harness/runs/${RUN_ID}/questions/7`)
      .set('X-API-Key', 'agent-key')
      .set('X-Test-Runtime', '4');
    expect(read.statusCode).toBe(403);
    expect(read.body.error.code).toBe('FORBIDDEN');
  });

  it('a project member answers a pending question', async () => {
    TicketQuestionService.getForRun.mockResolvedValue(QUESTION);
    TicketQuestionService.answer.mockResolvedValue({
      ...QUESTION, status: 'answered', answered_at: '2026-11-22T10:00:00.000Z',
    });
    pool.query.mockResolvedValue({ rows: [{ owner_id: '1', is_member: false }] });

    const res = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions/7/answer`)
      .set('Authorization', 'Bearer token')
      .send({ answer: 'Use the existing helper.' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data).toMatchObject({ id: 7, status: 'answered' });
    expect(TicketQuestionService.answer).toHaveBeenCalledWith(
      RUN_ID, '7', { answer: 'Use the existing helper.', userId: '1' }
    );
  });

  it('an outsider cannot read or answer', async () => {
    TicketQuestionService.getForRun.mockResolvedValue(QUESTION);
    pool.query.mockResolvedValue({ rows: [{ owner_id: '2', is_member: false }] });

    const read = await request(app)
      .get(`/api/v1/harness/runs/${RUN_ID}/questions/7`)
      .set('Authorization', 'Bearer token');
    expect(read.statusCode).toBe(403);

    const answer = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions/7/answer`)
      .set('Authorization', 'Bearer token')
      .send({ answer: 'hello' });
    expect(answer.statusCode).toBe(403);
    expect(TicketQuestionService.answer).not.toHaveBeenCalled();
  });

  it('a second answer returns 409', async () => {
    TicketQuestionService.getForRun.mockResolvedValue(QUESTION);
    pool.query.mockResolvedValue({ rows: [{ owner_id: '1', is_member: false }] });
    const conflict = new ConflictError('Question already answered');
    conflict.code = 'QUESTION_ALREADY_ANSWERED';
    TicketQuestionService.answer.mockRejectedValue(conflict);

    const res = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions/7/answer`)
      .set('Authorization', 'Bearer token')
      .send({ answer: 'again' });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('QUESTION_ALREADY_ANSWERED');
  });

  it('an expired question cannot be answered', async () => {
    TicketQuestionService.getForRun.mockResolvedValue({ ...QUESTION, status: 'expired' });
    pool.query.mockResolvedValue({ rows: [{ owner_id: '1', is_member: false }] });
    const conflict = new ConflictError('Question expired');
    conflict.code = 'QUESTION_EXPIRED';
    TicketQuestionService.answer.mockRejectedValue(conflict);

    const res = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions/7/answer`)
      .set('Authorization', 'Bearer token')
      .send({ answer: 'too late' });

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe('QUESTION_EXPIRED');
  });

  it('an oversized prompt or answer returns 400', async () => {
    const prompt = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions`)
      .set('X-API-Key', 'agent-key')
      .send({ prompt: 'x'.repeat(8193) });
    expect(prompt.statusCode).toBe(400);

    const answer = await request(app)
      .post(`/api/v1/harness/runs/${RUN_ID}/questions/7/answer`)
      .set('Authorization', 'Bearer token')
      .send({ answer: 'x'.repeat(8193) });
    expect(answer.statusCode).toBe(400);
  });

  it('notifications are scoped to the authenticated user', async () => {
    NotificationService.listForUser.mockResolvedValue([]);
    NotificationService.markRead.mockResolvedValue({ id: 9, read_at: 'now' });
    NotificationService.markAllRead.mockResolvedValue(2);

    const count = await request(app)
      .get('/api/v1/notifications/unread-count')
      .set('Authorization', 'Bearer token');
    expect(count.statusCode).toBe(200);
    expect(count.body.data).toEqual({ count: 3 });
    expect(NotificationService.unreadCount).toHaveBeenCalledWith('1');

    await request(app)
      .get('/api/v1/notifications?unread=true')
      .set('Authorization', 'Bearer token');
    expect(NotificationService.listForUser).toHaveBeenCalledWith('1',
      expect.objectContaining({ unread: true }));

    const read = await request(app)
      .post('/api/v1/notifications/9/read')
      .set('Authorization', 'Bearer token');
    expect(read.statusCode).toBe(200);
    expect(NotificationService.markRead).toHaveBeenCalledWith('1', '9');

    const all = await request(app)
      .post('/api/v1/notifications/read-all')
      .set('Authorization', 'Bearer token');
    expect(all.statusCode).toBe(200);
    expect(all.body.data.updated).toBe(2);
  });
});
