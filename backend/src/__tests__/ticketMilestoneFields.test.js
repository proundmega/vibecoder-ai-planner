const TicketService = require('../services/TicketService');
const Ticket = require('../models/ticket');
const Project = require('../models/project');
const User = require('../models/user');
const PermissionService = require('../services/PermissionService');
const { ValidationError, NotFoundError } = require('../errors/HttpError');

jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');

const MILESTONE_ID = '123e4567-e89b-12d3-a456-426614174000';

function existingTicket(overrides = {}) {
  return {
    id: 1,
    projectId: 7,
    ownerId: 100,
    assigneeId: null,
    status: 'backlog',
    ...overrides,
  };
}

describe('TicketService.update() milestone fields (bp-124 O1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    User.find.mockResolvedValue({ role: 'project_admin' });
    PermissionService.hasPermission.mockResolvedValue(true);
    Project.findById.mockResolvedValue({ id: 7, ownerId: 100 });
    Ticket.findById.mockResolvedValue(existingTicket());
    Ticket.findByProject.mockResolvedValue([existingTicket()]);
    Ticket.update.mockResolvedValue(existingTicket());
  });

  it('persists milestoneId, estimate and dependsOn', async () => {
    require('../db').pool.query.mockResolvedValueOnce({ rows: [{ id: MILESTONE_ID }] });

    await TicketService.update(1, {
      milestoneId: MILESTONE_ID,
      estimate: 5,
      dependsOn: [2, 3],
    }, 100, 'project_admin');

    expect(Ticket.update).toHaveBeenCalledWith(1, expect.objectContaining({
      milestoneId: MILESTONE_ID,
      estimate: 5,
      dependsOn: [2, 3],
    }));
  });

  it('allows clearing milestoneId with null', async () => {
    await TicketService.update(1, { milestoneId: null }, 100, 'project_admin');

    expect(Ticket.update).toHaveBeenCalledWith(1, expect.objectContaining({ milestoneId: null }));
  });

  it('accepts the legacy snake_case aliases', async () => {
    require('../db').pool.query.mockResolvedValueOnce({ rows: [{ id: MILESTONE_ID }] });

    await TicketService.update(1, {
      milestone_id: MILESTONE_ID,
      estimate: 2,
      depends_on: [2],
    }, 100, 'project_admin');

    expect(Ticket.update).toHaveBeenCalledWith(1, expect.objectContaining({
      milestoneId: MILESTONE_ID,
      dependsOn: [2],
    }));
  });

  it('rejects a milestone from another project', async () => {
    require('../db').pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(TicketService.update(1, { milestoneId: MILESTONE_ID }, 100, 'project_admin'))
      .rejects
      .toThrow(NotFoundError);
    expect(Ticket.update).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, '3'])('rejects a non-positive/non-integer estimate: %s', async (estimate) => {
    await expect(TicketService.update(1, { estimate }, 100, 'project_admin'))
      .rejects
      .toThrow(ValidationError);
    expect(Ticket.update).not.toHaveBeenCalled();
  });

  it('rejects a circular dependency', async () => {
    // Ticket 1 depends on 2; ticket 2 depends on 1 => cycle.
    Ticket.findById.mockResolvedValue(existingTicket({ id: 1 }));
    Ticket.findByProject.mockResolvedValue([
      existingTicket({ id: 1, dependsOn: [] }),
      existingTicket({ id: 2, dependsOn: [1] }),
    ]);

    await expect(TicketService.update(1, { dependsOn: [2] }, 100, 'project_admin'))
      .rejects
      .toThrow(ValidationError);
  });
});
