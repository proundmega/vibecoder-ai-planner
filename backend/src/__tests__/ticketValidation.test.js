const request = require('supertest');
const app = require('../index');

jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('../services/TicketService');
jest.mock('../models/user');
jest.mock('../models/project');
jest.mock('../services/ApprovalService');
jest.mock('../services/TicketPlanningService', () => ({ getPlanningForTicket: jest.fn().mockResolvedValue(null) }));
jest.mock('../services/TicketAttachmentService', () => ({ list: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/PhaseService', () => ({
  getPhaseHistory: jest.fn().mockResolvedValue([]),
  getCurrentPhase: jest.fn().mockResolvedValue('draft'),
  getAllowedNextPhases: jest.fn().mockResolvedValue([]),
  transition: jest.fn(),
}));
jest.mock('../services/GitHubService', () => ({ getPRDiff: jest.fn().mockResolvedValue([]) }));
jest.mock('../services/TemplateService');
jest.mock('../middleware/multer', () => ({ single: jest.fn(() => (req, res, next) => next()) }));
jest.mock('../controllers/ticketAttachmentController', () => ({
  upload: jest.fn((req, res) => res.json({ success: true, data: {} })),
  list: jest.fn((req, res) => res.json({ success: true, data: [] })),
  delete: jest.fn((req, res) => res.json({ success: true, data: true })),
  get: jest.fn((req, res) => res.json({ success: true, data: null })),
}));
jest.mock('../controllers/ticketPlanningController', () => ({
  list: jest.fn((req, res) => res.json({ success: true, data: [] })),
  get: jest.fn((req, res) => res.json({ success: true, data: null })),
  upsert: jest.fn((req, res) => res.json({ success: true, data: {} })),
  applyTemplate: jest.fn((req, res) => res.json({ success: true, data: {} })),
  updateStatus: jest.fn((req, res) => res.json({ success: true, data: {} })),
}));
jest.mock('../models/project', () => ({
  findById: jest.fn().mockResolvedValue({ id: 1, name: 'Test' }),
}));

jest.mock('../db', () => {
  const pool = {
    query: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  pool.query.mockImplementation((sql, params) => {
    if (sql.includes('INSERT INTO provider_configs')) {
      return Promise.resolve({
        rows: [{
          id: 'pc-1',
          project_id: 1,
          provider: 'openai',
          endpoint_url: null,
          model: 'gpt-4',
          api_key_encrypted: null,
          fallback_provider: null,
          routing_rules: {},
          is_active: true,
          created_at: new Date(),
          updated_at: new Date(),
        }],
      });
    }
    if (sql.includes('SELECT * FROM provider_configs')) {
      return Promise.resolve({ rows: [] });
    }
    return Promise.resolve({ rows: [] });
  });
  return { pool };
});

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin', userId: 'user-1' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

const TicketService = require('../services/TicketService');
const User = require('../models/user');

describe('PUT /tickets/:ticketId validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TicketService.getOne.mockResolvedValue({
      id: 't1',
      title: 'Test Ticket',
      status: 'backlog',
      owner_id: 'user-1',
    });
    User.find.mockResolvedValue({ role: 'project_admin', id: 'user-1' });
    TicketService.update.mockResolvedValue({ id: 't1', title: 'Updated' });
  });

  it('should return 400 for invalid status value', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'invalid_status' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for missing title when title is provided as empty string', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ title: '' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should return 400 for invalid priority value', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ priority: 'invalid_priority' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('should accept valid status transition', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'in_progress' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should accept valid priority values', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ priority: 'high' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('should accept null assigneeId to unassign', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ assigneeId: null });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
