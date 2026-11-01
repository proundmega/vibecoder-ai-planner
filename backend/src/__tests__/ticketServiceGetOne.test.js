const TicketService = require('../services/TicketService');
const Ticket = require('../models/ticket');
const User = require('../models/user');

jest.mock('../models/ticket');
jest.mock('../models/user');
jest.mock('../models/project');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');

const TicketPlanningService = require('../services/TicketPlanningService');
const TicketAttachmentService = require('../services/TicketAttachmentService');

describe('TicketService.getOne()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    TicketPlanningService.getPlanningForTicket.mockResolvedValue(null);
    TicketAttachmentService.list.mockResolvedValue([]);
  });

  it('resolves assigneeName for the ticket detail view', async () => {
    Ticket.findById.mockResolvedValue({
      id: 1,
      projectId: 2,
      title: 'Fix login',
      assigneeId: 9,
    });
    User.find.mockResolvedValue({ id: 9, name: 'Alice' });

    const ticket = await TicketService.getOne(1, 3);

    expect(User.find).toHaveBeenCalledWith(9);
    expect(ticket.assigneeName).toBe('Alice');
  });

  it('returns assigneeName null when the ticket is unassigned', async () => {
    Ticket.findById.mockResolvedValue({
      id: 1,
      projectId: 2,
      title: 'Fix login',
      assigneeId: null,
    });

    const ticket = await TicketService.getOne(1, 3);

    expect(User.find).not.toHaveBeenCalled();
    expect(ticket.assigneeName).toBeNull();
  });
});
