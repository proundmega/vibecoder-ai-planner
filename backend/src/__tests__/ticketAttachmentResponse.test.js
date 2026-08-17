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

jest.mock('../models/user', () => ({
  find: jest.fn().mockResolvedValue({ id: 'user-1', role: 'project_admin' }),
}));

jest.mock('../models/project', () => ({
  findById: jest.fn().mockResolvedValue({ id: 'p1', name: 'Test' }),
}));

jest.mock('../services/TicketPlanningService', () => ({
  getPlanningForTicket: jest.fn().mockResolvedValue([]),
}));

jest.mock('../utils/crypto', () => ({
  encrypt: jest.fn((text) => text ? `encrypted:${text}` : null),
  decrypt: jest.fn((text) => text?.replace('encrypted:', '') || ''),
  maskToken: jest.fn((text) => text ? text.substring(0, 3) + '***' : ''),
}));

describe('stored_path absent from ticket attachment responses (BP-61)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not include stored_path in ticket attachment response', async () => {
    // Mock TicketAttachmentService.list to return attachments with stored_path
    const TicketAttachmentService = require('../services/TicketAttachmentService');
    TicketAttachmentService.list = jest.fn().mockResolvedValue([
      {
        id: 'a1',
        filename: 'test.txt',
        content_type: 'text/plain',
        size_bytes: 1024,
        stored_path: '/uploads/secret/path/test.txt',
        uploaded_by_name: 'Test User',
        created_at: new Date(),
      },
    ]);

    // Mock Ticket.findById
    const Ticket = require('../models/ticket');
    Ticket.findById = jest.fn().mockResolvedValue({
      id: 't1',
      title: 'Test Ticket',
      status: 'backlog',
      priority: 'medium',
      ownerId: 'user-1',
      assigneeId: null,
      projectId: 'p1',
    });

    const res = await request(app)
      .get('/api/v1/tickets/1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    
    // Check that stored_path is NOT in the attachment response
    const attachments = res.body.data.attachments;
    expect(attachments).toBeDefined();
    expect(attachments.length).toBeGreaterThan(0);
    
    const attachment = attachments[0];
    expect(attachment.id).toBe('a1');
    expect(attachment.filename).toBe('test.txt');
    expect(attachment.contentType).toBe('text/plain');
    expect(attachment.sizeBytes).toBe(1024);
    expect(attachment.uploadedBy).toBe('Test User');
    
    // stored_path should NOT be present
    expect(attachment).not.toHaveProperty('storedPath');
    expect(attachment).not.toHaveProperty('stored_path');
  });

  it('includes all expected attachment fields except stored_path', async () => {
    const TicketAttachmentService = require('../services/TicketAttachmentService');
    TicketAttachmentService.list = jest.fn().mockResolvedValue([
      {
        id: 'a1',
        filename: 'test.txt',
        content_type: 'text/plain',
        size_bytes: 1024,
        stored_path: '/uploads/secret/path/test.txt',
        uploaded_by_name: 'Test User',
        created_at: new Date(),
      },
    ]);

    const Ticket = require('../models/ticket');
    Ticket.findById = jest.fn().mockResolvedValue({
      id: 't1',
      title: 'Test Ticket',
      status: 'backlog',
      priority: 'medium',
      ownerId: 'user-1',
      assigneeId: null,
      projectId: 'p1',
    });

    const res = await request(app)
      .get('/api/v1/tickets/1')
      .set('Authorization', 'Bearer mock-token');

    expect(res.status).toBe(200);
    
    const attachment = res.body.data.attachments[0];
    
    // Verify all expected fields are present
    expect(attachment).toHaveProperty('id');
    expect(attachment).toHaveProperty('filename');
    expect(attachment).toHaveProperty('contentType');
    expect(attachment).toHaveProperty('sizeBytes');
    expect(attachment).toHaveProperty('uploadedBy');
    expect(attachment).toHaveProperty('uploadedAt');
    
    // Verify stored_path is NOT present
    expect(attachment.storedPath).toBeUndefined();
    expect(attachment.stored_path).toBeUndefined();
  });
});
