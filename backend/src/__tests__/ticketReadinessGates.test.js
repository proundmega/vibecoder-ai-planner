jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
  },
}));
jest.mock('../models/ticket');
jest.mock('../models/project');
jest.mock('../models/user');
jest.mock('../services/PermissionService');
jest.mock('../services/TicketPlanningService');
jest.mock('../services/TicketAttachmentService');
jest.mock('../services/DependencyService', () => ({
  enrich: jest.fn(async tickets => tickets),
  assertReady: jest.fn().mockResolvedValue({ ready: true }),
}));
jest.mock('../services/TicketReadinessService', () => ({
  assertReadyForExecution: jest.fn(),
  emitBlocked: jest.fn().mockResolvedValue(undefined),
  refreshReadyState: jest.fn().mockResolvedValue(undefined),
}));

const { pool } = require('../db');
const Ticket = require('../models/ticket');
const PermissionService = require('../services/PermissionService');
const DependencyService = require('../services/DependencyService');
const TicketReadinessService = require('../services/TicketReadinessService');
const TicketService = require('../services/TicketService');
const PhaseService = require('../services/PhaseService');
const { ReadinessError } = require('../errors/HttpError');

const blockedResult = {
  ticketId: '10',
  source: 'test',
  mode: 'enforce',
  blocked: true,
  issues: [{ code: 'MISSING_TEMPLATE', message: 'Apply a template', waivable: false }],
  waivedCodes: [],
};

function readinessFailure() {
  return new ReadinessError(blockedResult);
}

function transactionClient(ticketRow) {
  const client = {
    query: jest.fn(async (sql) => {
      if (String(sql).includes('SELECT * FROM tickets')) return { rows: [ticketRow] };
      if (String(sql).includes('SELECT id FROM tickets')) return { rows: [{ id: ticketRow.id }] };
      return { rows: [] };
    }),
    release: jest.fn(),
  };
  pool.connect.mockResolvedValue(client);
  return client;
}

describe('fg-45 execution gate covers all five paths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService.hasPermission.mockResolvedValue(true);
    TicketReadinessService.assertReadyForExecution.mockRejectedValue(readinessFailure());
  });

  test('agent pickup returns READINESS_FAILED and audits after rollback', async () => {
    const ticket = {
      id: '10',
      project_id: '1',
      owner_id: '100',
      status: 'backlog',
      assigned_runtime_id: null,
    };
    pool.query
      .mockResolvedValueOnce({ rows: [{ owner_id: '100', role: 'member' }] })
      .mockResolvedValueOnce({ rows: [ticket] });
    const client = transactionClient(ticket);

    await expect(
      TicketService.pickUpTicket('10', { runtimeId: '7', operatorId: '100' })
    ).rejects.toBeInstanceOf(ReadinessError);

    expect(TicketReadinessService.assertReadyForExecution).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ source: 'pickup', toStatus: 'in_progress', db: client })
    );
    expect(client.query.mock.calls.some(call => String(call[0]).includes('UPDATE tickets'))).toBe(false);
    expect(client.query.mock.calls.some(call => String(call[0]).includes('ROLLBACK'))).toBe(true);
    expect(TicketReadinessService.emitBlocked).toHaveBeenCalledWith(blockedResult);
  });

  test('POST /status into in_progress is gated', async () => {
    const client = transactionClient({ id: '10' });

    await expect(
      TicketService.updateStatus('10', 'in_progress', '100', 'project_admin')
    ).rejects.toBeInstanceOf(ReadinessError);

    expect(TicketReadinessService.assertReadyForExecution).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ source: 'status_transition', toStatus: 'in_progress', db: client })
    );
    expect(Ticket.updateStatus).not.toHaveBeenCalled();
  });

  test('PUT /tickets/:id with a status change into in_progress is gated', async () => {
    Ticket.findById.mockResolvedValueOnce({
      id: '10',
      status: 'backlog',
      ownerId: '100',
      projectId: '1',
    });
    const client = transactionClient({ id: '10' });

    await expect(
      TicketService.update('10', { status: 'in_progress' }, '100', 'project_admin')
    ).rejects.toBeInstanceOf(ReadinessError);

    expect(TicketReadinessService.assertReadyForExecution).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ source: 'ticket_update', toStatus: 'in_progress', db: client })
    );
    expect(Ticket.update).not.toHaveBeenCalled();
  });

  test('a non-execution ticket edit is not gated', async () => {
    Ticket.findById.mockResolvedValueOnce({
      id: '10',
      status: 'backlog',
      ownerId: '100',
      projectId: '1',
    });
    Ticket.update.mockResolvedValueOnce({ id: '10', title: 'New title' });

    await TicketService.update('10', { title: 'New title' }, '100', 'project_admin');

    expect(TicketReadinessService.assertReadyForExecution).not.toHaveBeenCalled();
    expect(TicketReadinessService.refreshReadyState).toHaveBeenCalled();
  });

  test('phase transitions into assigned/in_progress/blocked are gated', async () => {
    const ticket = { id: '10', phase: 'plan_approved', status: 'backlog' };
    pool.connect.mockResolvedValue({
      query: jest.fn(async (sql) => {
        if (String(sql).includes('SELECT * FROM tickets')) return { rows: [ticket] };
        return { rows: [] };
      }),
      release: jest.fn(),
    });

    await expect(PhaseService.transition('10', 'assigned')).rejects.toBeInstanceOf(ReadinessError);

    expect(TicketReadinessService.assertReadyForExecution).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({
        source: 'phase_transition:assigned',
        toStatus: 'in_progress',
        toPhase: 'assigned',
      })
    );
    expect(TicketReadinessService.emitBlocked).toHaveBeenCalled();
  });

  test('a passing readiness check still runs the phase write', async () => {
    TicketReadinessService.assertReadyForExecution.mockResolvedValueOnce({ ready: true });
    const ticket = { id: '10', phase: 'plan_approved', status: 'backlog' };
    const client = {
      query: jest.fn(async (sql) => {
        if (String(sql).includes('SELECT * FROM tickets')) return { rows: [ticket] };
        return { rows: [] };
      }),
      release: jest.fn(),
    };
    pool.connect.mockResolvedValue(client);

    const result = await PhaseService.transition('10', 'assigned');

    expect(result).toMatchObject({ toPhase: 'assigned', status: 'in_progress' });
    expect(client.query.mock.calls.some(call => String(call[0]).includes('UPDATE tickets SET phase'))).toBe(true);
    expect(DependencyService.assertReady).toHaveBeenCalled();
  });
});
