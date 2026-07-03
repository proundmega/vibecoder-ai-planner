const request = require('supertest');
const app = require('../index');

// Mock dependencies for supertest
jest.mock('../db', () => {
  const pool = {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    stats: jest.fn(() => ({ idleCount: 1 })),
  };
  return { pool };
});

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token')
}));

jest.mock('../services/TicketService', () => ({
  update: jest.fn().mockResolvedValue({ id: 't1', title: 'Updated' }),
  findById: jest.fn().mockResolvedValue({ id: 't1', title: 'Test', status: 'backlog', ownerId: 'user-1', assigneeId: 'user-1', projectId: 'p1' }),
}));

jest.mock('../services/TicketPlanningService', () => ({
  getPlanningForTicket: jest.fn().mockResolvedValue([]),
}));

jest.mock('../services/TicketAttachmentService', () => ({
  list: jest.fn().mockResolvedValue([]),
}));

jest.mock('../models/user', () => ({
  find: jest.fn().mockResolvedValue({ id: 'user-1', role: 'project_admin' }),
}));

jest.mock('../models/project', () => ({
  findById: jest.fn().mockResolvedValue({ id: 'p1', name: 'Test' }),
}));

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text) => text ? `encrypted:${text}` : null),
  decrypt: jest.fn((text) => text?.replace('encrypted:', '') || ''),
  maskToken: jest.fn((text) => text ? text.substring(0, 3) + '***' : ''),
}));

describe('PUT /tickets/:ticketId validates body (BP-60)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 400 for empty title', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ title: '' });
    
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for title exceeding max length', async () => {
    const longTitle = 'a'.repeat(501);
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ title: longTitle });
    
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid status', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'invalid_status' });
    
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid priority', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ priority: 'invalid_priority' });
    
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 for invalid UUID assigneeId', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ assigneeId: 'not-a-uuid' });
    
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it('accepts null assigneeId to clear assignment', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ assigneeId: null });
    
    // Validation passes (null is allowed for assigneeId)
    // Returns 404 since ticket not found in DB (mock returns null)
    expect(res.status).not.toBe(400);
  });

  it('accepts valid update data', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/t1')
      .set('Authorization', 'Bearer mock-token')
      .send({ title: 'Updated title', priority: 'high' });
    
    // Validation passes, returns 404 since ticket not found in DB
    expect(res.status).not.toBe(400);
  });
});
