const request = require('supertest');
const app = require('../index');
const { pool } = require('../db');
const AgentNodeService = require('../services/AgentNodeService');
const TicketService = require('../services/TicketService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn().mockResolvedValue({ rows: [] }),
    connect: jest.fn(),
    stats: jest.fn(() => ({ idleCount: 1 })),
  },
}));

jest.mock('../services/TicketService', () => ({
  pickUpTicket: jest.fn(),
  releaseTicket: jest.fn(),
}));

describe('node credential bridge (FR4, FR20, NFR1)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockResolvedValue({ rows: [] });
  });

  it('maps at_ + runtime header to the runtime identity on pickup', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: { id: 12, owner_id: 7 },
    });
    jest.spyOn(AgentNodeService, 'getRuntimeForNode').mockResolvedValue({
      id: 3,
      role: 'worker',
      current_project_id: 5,
    });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM tickets')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      if (sql.includes('FROM agent_node_grants')) return Promise.resolve({ rows: [{ id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    TicketService.pickUpTicket.mockResolvedValue({
      id: 1, title: 't', status: 'in_progress', assigned_runtime_id: 3, locked_at: new Date(),
    });

    const res = await request(app)
      .post('/api/v1/tickets/1/pickup')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(res.statusCode).toBe(200);
    expect(TicketService.pickUpTicket).toHaveBeenCalledWith(
       '1',
      expect.objectContaining({ runtimeId: 3 })
    );
  });

  it('rejects a runtime without a grant for the ticket project', async () => {
    jest.spyOn(AgentNodeService, 'authenticateAccessToken').mockResolvedValue({
      status: 'ok',
      node: { id: 12, owner_id: 7 },
    });
    jest.spyOn(AgentNodeService, 'getRuntimeForNode').mockResolvedValue({
      id: 3,
      role: 'worker',
      current_project_id: 5,
    });
    pool.query.mockImplementation((sql) => {
      if (sql.includes('SELECT project_id FROM tickets')) return Promise.resolve({ rows: [{ project_id: 5 }] });
      return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
      .post('/api/v1/tickets/1/pickup')
      .set('X-API-Key', 'at_valid')
      .set('X-Agent-Runtime', '3');

    expect(res.statusCode).toBe(403);
    expect(TicketService.pickUpTicket).not.toHaveBeenCalled();
  });
});
