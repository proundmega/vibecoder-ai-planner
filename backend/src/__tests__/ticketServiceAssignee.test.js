const TicketService = require('../services/TicketService');
const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const { pool } = require('../db');

jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');

describe('TicketService.update() assignee validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService.hasPermission.mockResolvedValue(true);
    Project.findById.mockResolvedValue({ id: 1, ownerId: 100 });
    User.find.mockResolvedValue({ id: 6, name: 'Bob' });
    Ticket.findById.mockResolvedValue({
      id: 1,
      projectId: 1,
      ownerId: 100,
      assigneeId: 5,
      status: 'backlog',
    });
    pool.query.mockResolvedValue({ rows: [{ id: 6 }] });
    Ticket.update.mockResolvedValue(undefined);
  });

  it('checks membership against the project_memberships table', async () => {
    await TicketService.update(1, { assigneeId: 6 }, 100, 'project_admin');

    const sqlStatements = pool.query.mock.calls.map(([sql]) => sql);
    expect(sqlStatements.some(sql => /FROM project_memberships/.test(sql))).toBe(true);
    expect(sqlStatements.some(sql => /FROM project_members\b/.test(sql))).toBe(false);
  });
});
