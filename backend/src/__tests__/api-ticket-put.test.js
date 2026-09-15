const request = require('supertest');
const app = require('../index');
const TicketService = require('../services/TicketService');
const PermissionService = require('../services/PermissionService');
const User = require('../models/user');

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ id: 'user-1', email: 'user@test.com', role: 'project_admin' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../models/user', () => ({
  find: jest.fn().mockResolvedValue({ role: 'project_admin' }),
}));

jest.mock('../services/TicketService');
jest.mock('../services/PermissionService', () => ({
  hasPermission: jest.fn().mockResolvedValue(true),
  hasAnyPermission: jest.fn().mockResolvedValue(true),
}));
jest.mock('../services/TicketPlanningService', () => ({
  getPlanningForTicket: jest.fn().mockResolvedValue(null),
}));
jest.mock('../services/TicketAttachmentService', () => ({
  list: jest.fn().mockResolvedValue([]),
}));

describe('PUT /api/v1/tickets/:id — status-only body', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 with status-only body (regression: was SQL NOT NULL violation)', async () => {
    TicketService.getOne.mockResolvedValueOnce({
      id: 't1',
      title: 'Test Ticket',
      status: 'backlog',
      priority: 'medium',
      assigneeId: null,
      ownerId: 1,
      projectId: 1,
    });

    let capturedArgs;
    TicketService.update.mockImplementation((...args) => {
      capturedArgs = args;
      return { id: 't1', status: 'in_progress' };
    });

    const res = await request(app)
      .put('/api/v1/tickets/1')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'in_progress' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);

    // Verify TicketService.update received only the provided field (not null for others)
    expect(capturedArgs[0]).toBe('1');
    expect(capturedArgs[1]).toEqual({ status: 'in_progress' });
    expect(capturedArgs[1].title).toBeUndefined();
    expect(capturedArgs[1].description).toBeUndefined();
    expect(capturedArgs[1].priority).toBeUndefined();
    expect(capturedArgs[1].assigneeId).toBeUndefined();
  });

  it('should return 200 with full body including title', async () => {
    TicketService.getOne.mockResolvedValueOnce({
      id: 't1',
      title: 'Old Title',
      status: 'backlog',
      priority: 'medium',
      assigneeId: null,
      ownerId: 1,
      projectId: 1,
    });

    let capturedArgs;
    TicketService.update.mockImplementation((...args) => {
      capturedArgs = args;
      return { id: 't1', title: 'Updated Title', status: 'backlog' };
    });

    const res = await request(app)
      .put('/api/v1/tickets/1')
      .set('Authorization', 'Bearer mock-token')
      .send({ title: 'Updated Title', status: 'backlog' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(capturedArgs[1].title).toBe('Updated Title');
    expect(capturedArgs[1].status).toBe('backlog');
    expect(capturedArgs[1].description).toBeUndefined();
    expect(capturedArgs[1].priority).toBeUndefined();
  });

  it('should preserve existing title when not included in body', async () => {
    TicketService.getOne.mockResolvedValueOnce({
      id: 't1',
      title: 'Preserved Title',
      status: 'backlog',
      priority: 'medium',
      assigneeId: null,
      ownerId: 1,
      projectId: 1,
    });

    let capturedArgs;
    TicketService.update.mockImplementation((...args) => {
      capturedArgs = args;
      return { id: 't1', title: 'Preserved Title', status: 'in_progress' };
    });

    const res = await request(app)
      .put('/api/v1/tickets/1')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'in_progress' });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(capturedArgs[1].title).toBeUndefined();
    expect(capturedArgs[1].description).toBeUndefined();
    expect(capturedArgs[1].status).toBe('in_progress');
    expect(capturedArgs[1].priority).toBeUndefined();
    expect(capturedArgs[1].assigneeId).toBeUndefined();
  });

  it('should return 400 with invalid status value', async () => {
    const res = await request(app)
      .put('/api/v1/tickets/1')
      .set('Authorization', 'Bearer mock-token')
      .send({ status: 'invalid_status' });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  describe('PR URL update (bp-05)', () => {
    it('should accept prUrl in the request body', async () => {
      TicketService.getOne.mockResolvedValueOnce({
        id: 't1',
        title: 'Test Ticket',
        status: 'backlog',
        priority: 'medium',
        assigneeId: null,
        ownerId: 1,
        projectId: 1,
      });

      let capturedArgs;
      TicketService.update.mockImplementation((...args) => {
        capturedArgs = args;
        return { id: 't1', prUrl: 'https://github.com/test/repo/pull/1' };
      });

      const res = await request(app)
        .put('/api/v1/tickets/1')
        .set('Authorization', 'Bearer mock-token')
        .send({ prUrl: 'https://github.com/test/repo/pull/1' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(capturedArgs[1].prUrl).toBe('https://github.com/test/repo/pull/1');
    });

    it('should allow prUrl alongside status update', async () => {
      TicketService.getOne.mockResolvedValueOnce({
        id: 't1',
        title: 'Test Ticket',
        status: 'in_progress',
        priority: 'medium',
        assigneeId: null,
        ownerId: 1,
        projectId: 1,
      });

      let capturedArgs;
      TicketService.update.mockImplementation((...args) => {
        capturedArgs = args;
        return { id: 't1', status: 'review', prUrl: 'https://github.com/test/repo/pull/2' };
      });

      const res = await request(app)
        .put('/api/v1/tickets/1')
        .set('Authorization', 'Bearer mock-token')
        .send({ status: 'review', prUrl: 'https://github.com/test/repo/pull/2' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(capturedArgs[1].status).toBe('review');
      expect(capturedArgs[1].prUrl).toBe('https://github.com/test/repo/pull/2');
    });

    it('should work without prUrl (backward compatible)', async () => {
      TicketService.getOne.mockResolvedValueOnce({
        id: 't1',
        title: 'Test Ticket',
        status: 'backlog',
        priority: 'medium',
        assigneeId: null,
        ownerId: 1,
        projectId: 1,
      });

      let capturedArgs;
      TicketService.update.mockImplementation((...args) => {
        capturedArgs = args;
        return { id: 't1', status: 'in_progress' };
      });

      const res = await request(app)
        .put('/api/v1/tickets/1')
        .set('Authorization', 'Bearer mock-token')
        .send({ status: 'in_progress' });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(capturedArgs[1].prUrl).toBeUndefined();
      expect(capturedArgs[1].status).toBe('in_progress');
    });
  });
});
