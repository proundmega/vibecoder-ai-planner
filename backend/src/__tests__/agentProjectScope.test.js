const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const AgentEnrollmentService = require('../services/AgentEnrollmentService');
const PermissionService = require('../services/PermissionService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
  hasPermission: jest.fn().mockResolvedValue(true),
}));

jest.mock('../controllers/ticketController', () => ({
  createTicket: (req, res) => res.status(201).json({ success: true }),
  getProjectTickets: (req, res) => res.json({ success: true, data: [] }),
  getBacklogTickets: (req, res) => res.json({ success: true, data: [] }),
  getTicket: (req, res) => res.json({ success: true }),
  updateTicket: (req, res) => res.json({ success: true }),
  changeStatus: (req, res) => res.json({ success: true }),
  pickUpTicket: (req, res) => res.json({ success: true }),
  releaseTicket: (req, res) => res.json({ success: true }),
  getMessages: (req, res) => res.json({ success: true, data: [] }),
  postMessage: (req, res) => res.json({ success: true }),
  deleteTicket: (req, res) => res.json({ success: true }),
  getTicketComments: (req, res) => res.json({ success: true, data: [] }),
  addComment: (req, res) => res.json({ success: true }),
}));

const {
  assertAgentProject,
  forProjectParam,
  forBodyProject,
  forTicketParam,
} = require('../middleware/agentProjectScope');

function enrolledAgent(projectId) {
  return { id: 42, owner_id: 7, project_id: projectId, name: 'worker' };
}

describe('agent project scope (FR3, NFR2)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService.hasAnyPermission.mockResolvedValue(true);
    pool.query.mockResolvedValue({ rows: [] });
    jest.spyOn(AgentEnrollmentService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      agent: enrolledAgent(3),
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('asserts the agent project and lets legacy NULL agents through', () => {
    expect(assertAgentProject({ agent: enrolledAgent(3) }, 3)).toBe(true);
    expect(assertAgentProject({ agent: enrolledAgent(3) }, 4)).toBe(false);
    expect(assertAgentProject({ agent: { id: 1, project_id: null } }, 4)).toBe(true);
    expect(assertAgentProject({ user: { userId: 7 } }, 4)).toBe(true);
  });

  it('rejects a cross-project ticket list with 403', async () => {
    const res = await request(app)
      .get('/api/v1/tickets/project/4')
      .set('X-API-Key', 'at_valid');

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows the agent project ticket list through', async () => {
    const res = await request(app)
      .get('/api/v1/tickets/project/3')
      .set('X-API-Key', 'at_valid');

    expect(res.statusCode).toBe(200);
  });

  it('rejects cross-project ticket creation before the controller', async () => {
    const res = await request(app)
      .post('/api/v1/tickets')
      .set('X-API-Key', 'at_valid')
      .send({ projectId: 4, title: 'cross-project' });

    expect(res.statusCode).toBe(403);
  });

  it('resolves the ticket project for ticket routes', async () => {
    pool.query.mockResolvedValue({ rows: [{ project_id: 4 }] });
    const res = await request(app)
      .get('/api/v1/tickets/99')
      .set('X-API-Key', 'at_valid');

    expect(res.statusCode).toBe(403);
  });

  it('allows a ticket in the agent project', async () => {
    pool.query.mockResolvedValue({ rows: [{ project_id: 3 }] });
    const res = await request(app)
      .get('/api/v1/tickets/99')
      .set('X-API-Key', 'at_valid');

    expect(res.statusCode).toBe(200);
  });

  it('does not scope JWT operators', async () => {
    const next = jest.fn();
    const res = {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json() { return this; },
    };
    forProjectParam()({ user: { userId: 7 }, params: { projectId: '4' } }, res, next);
    expect(next).toHaveBeenCalled();

    const bodyNext = jest.fn();
    forBodyProject()({ user: { userId: 7 }, body: { projectId: 4 } }, res, bodyNext);
    expect(bodyNext).toHaveBeenCalled();
  });

  it('queries the ticket project once per scoped request', async () => {
    const next = jest.fn();
    const res = { status() { return this; }, json() { return this; } };
    pool.query.mockResolvedValue({ rows: [{ project_id: 3 }] });
    await forTicketParam()(
      { agent: enrolledAgent(3), params: { ticketId: '99' } },
      res,
      next
    );
    expect(pool.query).toHaveBeenCalledWith('SELECT project_id FROM tickets WHERE id = $1', ['99']);
    expect(next).toHaveBeenCalled();
  });
});
