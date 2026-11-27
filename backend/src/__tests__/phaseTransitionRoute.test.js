const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../index');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const Ticket = require('../models/ticket');
const TicketService = require('../services/TicketService');
const PermissionService = require('../services/PermissionService');
const phaseService = require('../services/PhaseService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
  transaction: jest.fn(),
}));

jest.mock('../services/PhaseService', () => ({
  transition: jest.fn(),
  getAllowedNextPhases: jest.fn(),
}));

function mockWorkerRuntime() {
  jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
    status: 'ok',
    node: { id: 12, owner_id: 7 },
  });
  jest.spyOn(AgentNodeService, 'getRuntimeForNode').mockResolvedValue({
    id: 3,
    role: 'worker',
    status: 'running',
    current_project_id: 5,
  });
  pool.query.mockImplementation((sql) => {
    if (sql.includes('SELECT project_id FROM tickets')) {
      return Promise.resolve({ rows: [{ project_id: 5 }] });
    }
    if (sql.includes('FROM agent_node_grants')) {
      return Promise.resolve({ rows: [{ id: 1 }] });
    }
    return Promise.resolve({ rows: [] });
  });
}

function transitionRequest(body) {
  return request(app)
    .post('/api/v1/tickets/42/phases/transition')
    .send(body);
}

describe('POST /tickets/:id/phases/transition actor identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jwt.verify.mockReturnValue({ userId: 7, role: 'member' });
    jest.spyOn(PermissionService, 'hasAnyPermission').mockResolvedValue(true);
    jest.spyOn(Ticket, 'findById').mockResolvedValue({ id: 42, projectId: 5, ownerId: 1 });
    jest.spyOn(TicketService, 'canActOnTicketProject').mockResolvedValue(true);
    mockWorkerRuntime();
    phaseService.transition.mockResolvedValue({
      ticketId: 42, fromPhase: 'review', toPhase: 'in_progress', status: 'in_progress',
    });
  });

  test('derives a human actor from the JWT and ignores nothing else', async () => {
    const response = await transitionRequest({
      toPhase: 'in_progress',
      metadata: { reason: 'fix it' },
    }).set('Authorization', 'Bearer mock-token');

    expect(response.statusCode).toBe(200);
    expect(phaseService.transition).toHaveBeenCalledWith(
      '42', 'in_progress', 'human', 7, { reason: 'fix it' });
  });

  test('rejects a human claiming to be an agent', async () => {
    const response = await transitionRequest({
      toPhase: 'in_progress',
      actorType: 'agent',
      metadata: { reason: 'fix it' },
    }).set('Authorization', 'Bearer mock-token');

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ACTOR_TYPE');
    expect(phaseService.transition).not.toHaveBeenCalled();
  });

  test('rejects an agent claiming to be human before any dispatch', async () => {
    const response = await transitionRequest({
      toPhase: 'in_progress',
      actorType: 'human',
      metadata: { reason: 'spoofed manual dispatch' },
    })
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('INVALID_ACTOR_TYPE');
    expect(phaseService.transition).not.toHaveBeenCalled();
  });

  test('records an agent actor from the runtime, not the body', async () => {
    const response = await transitionRequest({ toPhase: 'in_progress' })
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(response.statusCode).toBe(200);
    expect(phaseService.transition).toHaveBeenCalledWith(
      '42', 'in_progress', 'agent', 3, null);
  });

  test('requires TICKET_STATUS_CHANGE from a human', async () => {
    PermissionService.hasAnyPermission.mockResolvedValue(false);

    const response = await transitionRequest({
      toPhase: 'in_progress',
      metadata: { reason: 'fix it' },
    }).set('Authorization', 'Bearer mock-token');

    expect(response.statusCode).toBe(403);
    expect(phaseService.transition).not.toHaveBeenCalled();
  });

  test('requires human project membership', async () => {
    TicketService.canActOnTicketProject.mockResolvedValue(false);

    const response = await transitionRequest({
      toPhase: 'in_progress',
      metadata: { reason: 'fix it' },
    }).set('Authorization', 'Bearer mock-token');

    expect(response.statusCode).toBe(403);
    expect(phaseService.transition).not.toHaveBeenCalled();
  });
});
