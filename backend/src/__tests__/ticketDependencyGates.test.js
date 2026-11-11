jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
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
  assertReady: jest.fn(),
}));

const { pool } = require('../db');
const Ticket = require('../models/ticket');
const PermissionService = require('../services/PermissionService');
const DependencyService = require('../services/DependencyService');
const TicketService = require('../services/TicketService');
const { DependencyConflictError } = require('../errors/HttpError');

function clientFor(selectRows = []) {
  const client = {
    query: jest.fn(),
    release: jest.fn(),
  };
  client.query
    .mockResolvedValueOnce({}) // BEGIN
    .mockResolvedValueOnce({ rows: selectRows }) // SELECT ... FOR UPDATE
    .mockResolvedValueOnce({}) // COMMIT or ROLLBACK
    .mockResolvedValueOnce({}); // spare
  pool.connect.mockResolvedValueOnce(client);
  return client;
}

describe('bp-134 dependency gates', () => {
  const backlogTicket = {
    id: '10',
    project_id: '1',
    owner_id: '100',
    status: 'backlog',
    assigned_agent_id: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    PermissionService.hasPermission.mockResolvedValue(true);
  });

  it('blocks pickup and rolls back when a dependency is incomplete', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ owner_id: '100', role: 'member' }] })
      .mockResolvedValueOnce({ rows: [backlogTicket] });
    const client = clientFor([backlogTicket]);
    DependencyService.assertReady.mockRejectedValueOnce(
      new DependencyConflictError('blocked', { blockedBy: [] })
    );

    await expect(
      TicketService.pickUpTicket('10', { agentId: '7', operatorId: '100' })
    ).rejects.toBeInstanceOf(DependencyConflictError);

    expect(DependencyService.assertReady).toHaveBeenCalledWith('10', {
      client,
      lock: true,
      action: 'pickup',
    });
    expect(pool.query.mock.calls.some(call => String(call[0]).includes('UPDATE tickets'))).toBe(false);
  });

  it('blocks an in_progress status transition', async () => {
    const client = clientFor([{ id: '10' }]);
    DependencyService.assertReady.mockRejectedValueOnce(
      new DependencyConflictError('blocked', { blockedBy: [] })
    );

    await expect(TicketService.updateStatus('10', 'in_progress', '100')).rejects.toBeInstanceOf(
      DependencyConflictError
    );

    expect(DependencyService.assertReady).toHaveBeenCalledWith('10', {
      client,
      lock: true,
      action: 'status_transition',
    });
    expect(Ticket.updateStatus).not.toHaveBeenCalled();
  });

  it('does not gate a non-execution status transition', async () => {
    Ticket.updateStatus.mockResolvedValueOnce(undefined);

    await TicketService.updateStatus('10', 'review', '100');

    expect(DependencyService.assertReady).not.toHaveBeenCalled();
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('blocks an update that enters in_progress', async () => {
    Ticket.findById.mockResolvedValueOnce({
      id: '10',
      status: 'backlog',
      ownerId: '100',
      projectId: '1',
    });
    const client = clientFor([{ id: '10' }]);
    DependencyService.assertReady.mockRejectedValueOnce(
      new DependencyConflictError('blocked', { blockedBy: [] })
    );

    await expect(
      TicketService.update('10', { status: 'in_progress' }, '100', 'member')
    ).rejects.toBeInstanceOf(DependencyConflictError);

    expect(DependencyService.assertReady).toHaveBeenCalledWith('10', {
      client,
      lock: true,
      dependsOn: undefined,
      action: 'ticket_update',
    });
    expect(Ticket.update).not.toHaveBeenCalled();
  });

  it('checks the payload dependsOn set when the same request starts the ticket', async () => {
    Ticket.findById.mockResolvedValueOnce({
      id: '10',
      status: 'backlog',
      ownerId: '100',
      projectId: '1',
      dependsOn: [],
    });
    Ticket.findByProject.mockResolvedValueOnce([]);
    const client = clientFor([{ id: '10' }]);
    DependencyService.assertReady.mockRejectedValueOnce(
      new DependencyConflictError('blocked', { blockedBy: [] })
    );

    await expect(
      TicketService.update(
        '10',
        { status: 'in_progress', dependsOn: ['11'] },
        '100',
        'member'
      )
    ).rejects.toBeInstanceOf(DependencyConflictError);

    expect(DependencyService.assertReady).toHaveBeenCalledWith('10', {
      client,
      lock: true,
      dependsOn: ['11'],
      action: 'ticket_update',
    });
    expect(Ticket.update).not.toHaveBeenCalled();
  });

  it('passes the transaction client to Ticket.update when readiness succeeds', async () => {
    Ticket.findById.mockResolvedValueOnce({
      id: '10',
      status: 'backlog',
      ownerId: '100',
      projectId: '1',
    });
    const client = clientFor([{ id: '10' }]);
    DependencyService.assertReady.mockResolvedValueOnce({ ready: true, blockedBy: [] });
    Ticket.update.mockResolvedValueOnce({ id: '10', status: 'in_progress' });

    await TicketService.update('10', { status: 'in_progress' }, '100', 'member');

    expect(Ticket.update).toHaveBeenCalledWith(
      '10',
      expect.objectContaining({ status: 'in_progress' }),
      client
    );
  });
});
