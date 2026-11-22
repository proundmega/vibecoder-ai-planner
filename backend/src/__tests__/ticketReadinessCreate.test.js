jest.mock('../models/project');
jest.mock('../models/ticket');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService', () => ({
  applyTemplate: jest.fn().mockResolvedValue([]),
}));
jest.mock('../services/TicketAttachmentService', () => ({}));
jest.mock('../services/TicketReadinessService', () => ({
  addCriteria: jest.fn().mockResolvedValue([]),
  smallFix: jest.fn().mockResolvedValue({}),
  assertReadyForExecution: jest.fn(),
  emitBlocked: jest.fn(),
  refreshReadyState: jest.fn(),
}));

const Project = require('../models/project');
const Ticket = require('../models/ticket');
const TicketPlanningService = require('../services/TicketPlanningService');
const TicketReadinessService = require('../services/TicketReadinessService');
const TicketService = require('../services/TicketService');

describe('fg-45 permissive ticket creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Project.findById.mockResolvedValue({ id: '1', ownerId: '100' });
    Ticket.create.mockResolvedValue({ id: '10', projectId: '1', title: 'Title' });
  });

  test('a title-only ticket is created without readiness state', async () => {
    const ticket = await TicketService.create('1', 'Title', '', 'medium', '100');

    expect(ticket).toMatchObject({ id: '10' });
    expect(TicketPlanningService.applyTemplate).not.toHaveBeenCalled();
    expect(TicketReadinessService.smallFix).not.toHaveBeenCalled();
    expect(TicketReadinessService.addCriteria).not.toHaveBeenCalled();
  });

  test('optional wizard inputs seed criteria, template and small fix', async () => {
    await TicketService.create('1', 'Title', 'description', 'medium', '100', {
      acceptanceCriteria: ['Given a draft, when it starts, then it is gated'],
      template: 'simple',
      smallFix: { reason: 'Single-file label change' },
    });

    expect(TicketReadinessService.addCriteria).toHaveBeenCalledWith(
      '10',
      ['Given a draft, when it starts, then it is gated'],
      { type: 'user', userId: '100' }
    );
    expect(TicketPlanningService.applyTemplate).toHaveBeenCalledWith('10', 'simple', '100');
    expect(TicketReadinessService.smallFix).toHaveBeenCalledWith(
      '10',
      'Single-file label change',
      { type: 'user', userId: '100' }
    );

    // Criteria are inserted before the template so a spec seed cannot duplicate them.
    const criteriaOrder = TicketReadinessService.addCriteria.mock.invocationCallOrder[0];
    const templateOrder = TicketPlanningService.applyTemplate.mock.invocationCallOrder[0];
    expect(criteriaOrder).toBeLessThan(templateOrder);
  });

  test('an unknown project still fails before creation', async () => {
    Project.findById.mockResolvedValueOnce(null);

    await expect(
      TicketService.create('404', 'Title', '', 'medium', '100')
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(Ticket.create).not.toHaveBeenCalled();
  });
});
