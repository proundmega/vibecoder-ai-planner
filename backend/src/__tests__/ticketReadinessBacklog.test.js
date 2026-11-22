jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketAttachmentService', () => ({}));
jest.mock('../services/TicketPlanningService', () => ({}));
jest.mock('../services/DependencyService', () => ({
  enrich: jest.fn(async tickets => tickets),
  assertReady: jest.fn(),
}));
jest.mock('../services/TicketReadinessService', () => ({
  gateMode: jest.fn(() => 'enforce'),
  isReadyForExecution: jest.fn(),
  assertReadyForExecution: jest.fn(),
  emitBlocked: jest.fn(),
  refreshReadyState: jest.fn(),
}));

const Ticket = require('../models/ticket');
const TicketReadinessService = require('../services/TicketReadinessService');
const TicketService = require('../services/TicketService');

describe('fg-45 agent backlog readiness filtering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('enforce filters an unready ticket so a ready ticket later in the list is reached', async () => {
    Ticket.findByStatus.mockResolvedValue([
      { id: 1, title: 'Unready', ready: true },
      { id: 2, title: 'Ready', ready: true },
    ]);
    TicketReadinessService.gateMode.mockReturnValue('enforce');
    TicketReadinessService.isReadyForExecution.mockImplementation(async (id) => id === 2);

    const tickets = await TicketService.findBacklog('1');

    expect(tickets.map(ticket => ticket.id)).toEqual([2]);
  });

  test('warn keeps both tickets because the gate allows the transition', async () => {
    Ticket.findByStatus.mockResolvedValue([
      { id: 1, title: 'Unready', ready: true },
      { id: 2, title: 'Ready', ready: true },
    ]);
    TicketReadinessService.gateMode.mockReturnValue('warn');

    const tickets = await TicketService.findBacklog('1');

    expect(tickets.map(ticket => ticket.id)).toEqual([1, 2]);
    expect(TicketReadinessService.isReadyForExecution).not.toHaveBeenCalled();
  });

  test('dependency-blocked tickets stay excluded', async () => {
    Ticket.findByStatus.mockResolvedValue([
      { id: 1, title: 'Blocked', ready: false },
      { id: 2, title: 'Ready', ready: true },
    ]);
    TicketReadinessService.gateMode.mockReturnValue('enforce');
    TicketReadinessService.isReadyForExecution.mockResolvedValue(true);

    const tickets = await TicketService.findBacklog('1');

    expect(tickets.map(ticket => ticket.id)).toEqual([2]);
  });
});
