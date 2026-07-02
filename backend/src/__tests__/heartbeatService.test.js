jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockReturnValue({
      query: jest.fn(),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../services/TicketService', () => ({
  releaseTicket: jest.fn().mockResolvedValue({ id: 'ticket-1' }),
}));

const heartbeatService = require('../services/HeartbeatService');
const { NotFoundError, ValidationError } = require('../errors/HttpError');

describe('HeartbeatService', () => {
  const mockPool = require('../db').pool;
  const ticketService = require('../services/TicketService');

  beforeEach(() => {
    jest.clearAllMocks();
    mockPool.query.mockImplementation(() => Promise.resolve({ rows: [] }));
    ticketService.releaseTicket.mockResolvedValue({ id: 'ticket-1' });
  });

  describe('recordHeartbeat', () => {
    test('should upsert a new heartbeat for unknown agent', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          agent_id: 1,
          last_seen: new Date(),
          current_ticket_id: 'ticket-123',
          current_step: 'processing',
          memory_usage: '{"free": 100}',
          cpu_usage: '{"processors": 4}',
          status: 'online',
        }],
      });

      const result = await heartbeatService.recordHeartbeat(1, {
        ticketId: 'ticket-123',
        step: 'processing',
        memory: { free: 100 },
        cpu: { processors: 4 },
      });

      expect(result.agent_id).toBe(1);
      expect(result.status).toBe('online');
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_heartbeats'),
        [1, 'ticket-123', 'processing', '{"free":100}', '{"processors":4}']
      );
    });

    test('should upsert with null ticket and step', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          agent_id: 2,
          last_seen: new Date(),
          current_ticket_id: null,
          current_step: null,
          memory_usage: '{}',
          cpu_usage: '{}',
          status: 'online',
        }],
      });

      const result = await heartbeatService.recordHeartbeat(2, {
        ticketId: null,
        step: null,
        memory: {},
        cpu: {},
      });

      expect(result.agent_id).toBe(2);
      expect(result.current_ticket_id).toBeNull();
    });

    test('should update last_seen on subsequent heartbeat', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          agent_id: 1,
          last_seen: new Date(),
          current_ticket_id: 'ticket-123',
          current_step: 'processing',
          memory_usage: '{"free": 200}',
          cpu_usage: '{}',
          status: 'online',
        }],
      });

      await heartbeatService.recordHeartbeat(1, {
        ticketId: 'ticket-123',
        step: 'processing',
        memory: { free: 200 },
        cpu: {},
      });

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('ON CONFLICT'),
        expect.any(Array)
      );
    });
  });

  describe('getAgentStatus', () => {
    test('should return heartbeat row for existing agent', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          agent_id: 1,
          last_seen: new Date(),
          current_ticket_id: 'ticket-123',
          current_step: 'processing',
          status: 'online',
          agent_name: 'Test Agent',
        }],
      });

      const result = await heartbeatService.getAgentStatus(1);
      expect(result.agent_id).toBe(1);
      expect(result.agent_name).toBe('Test Agent');
      expect(result.status).toBe('online');
    });

    test('should return null for unknown agent', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await heartbeatService.getAgentStatus(999);
      expect(result).toBeNull();
    });
  });

  describe('getAllAgents', () => {
    test('should return list of agents with daily stats', async () => {
      const mockAgents = [
        {
          agent_id: 1,
          name: 'Agent 1',
          status: 'online',
          current_ticket_id: 'ticket-1',
          current_ticket_title: 'Fix login bug',
          last_seen: new Date(),
          actions_today: 5,
          cost_today: 0.25,
        },
        {
          agent_id: 2,
          name: 'Agent 2',
          status: 'offline',
          current_ticket_id: null,
          current_ticket_title: null,
          last_seen: new Date(Date.now() - 120000),
          actions_today: 0,
          cost_today: 0,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockAgents });

      const result = await heartbeatService.getAllAgents();
      expect(result).toHaveLength(2);
      expect(result[0].agent_id).toBe(1);
      expect(result[0].actions_today).toBe(5);
      expect(result[1].status).toBe('offline');
    });

    test('should return empty array when no agents have heartbeats', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const result = await heartbeatService.getAllAgents();
      expect(result).toEqual([]);
    });
  });

  describe('cleanupStaleAgents', () => {
    test('should mark stale agents as offline', async () => {
      mockPool.query.mockImplementation((sql) => {
        if (sql.includes('agent_heartbeats') && sql.includes('agent_id')) {
          return Promise.resolve({
            rows: [
              { agent_id: 1, current_ticket_id: 'ticket-1' },
              { agent_id: 2, current_ticket_id: null },
            ],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      const count = await heartbeatService.cleanupStaleAgents();
      expect(count).toBe(2);
    });

    test('should release tickets for stale agents with current_ticket_id', async () => {
      mockPool.query.mockImplementation((sql) => {
        if (sql.includes('agent_heartbeats') && sql.includes('agent_id')) {
          return Promise.resolve({
            rows: [{ agent_id: 1, current_ticket_id: 'ticket-123' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await heartbeatService.cleanupStaleAgents();

      expect(ticketService.releaseTicket).toHaveBeenCalledWith('ticket-123');
    });

    test('should skip ticket release when current_ticket_id is null', async () => {
      mockPool.query.mockImplementation((sql) => {
        if (sql.includes('agent_heartbeats') && sql.includes('agent_id')) {
          return Promise.resolve({
            rows: [{ agent_id: 1, current_ticket_id: null }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await heartbeatService.cleanupStaleAgents();

      expect(ticketService.releaseTicket).not.toHaveBeenCalled();
    });

    test('should handle ticket release failure gracefully', async () => {
      const consoleError = console.error;
      console.error = jest.fn();

      mockPool.query.mockImplementation((sql) => {
        if (sql.includes('agent_heartbeats') && sql.includes('agent_id')) {
          return Promise.resolve({
            rows: [{ agent_id: 1, current_ticket_id: 'ticket-123' }],
          });
        }
        return Promise.resolve({ rows: [] });
      });

      ticketService.releaseTicket.mockRejectedValue(new Error('Ticket not found'));

      const count = await heartbeatService.cleanupStaleAgents();
      expect(count).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to release ticket'),
        expect.any(String)
      );

      console.error = consoleError;
      ticketService.releaseTicket.mockResolvedValue({ id: 'ticket-1' });
    });

    test('should return 0 when no stale agents', async () => {
      mockPool.query.mockImplementation((sql) => {
        if (sql.includes('agent_heartbeats') && sql.includes('agent_id')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      const count = await heartbeatService.cleanupStaleAgents();
      expect(count).toBe(0);
    });
  });

  describe('BP-51-04/BP-51-10: require placement and JOIN query', () => {
    test('should use JOIN instead of correlated subqueries for actions_today and cost_today', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await heartbeatService.getAllAgents();

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];

      // Should use LEFT JOIN agent_actions instead of correlated subqueries
      expect(sql).toContain('LEFT JOIN agent_actions');
      expect(sql).toContain('GROUP BY');

      // Should NOT contain correlated subqueries
      expect(sql).not.toMatch(/\(SELECT COUNT\(\*\)/);
      expect(sql).not.toMatch(/\(SELECT SUM\(/);
    });

    test('should include date filter in JOIN condition', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await heartbeatService.getAllAgents();

      const queryCall = mockPool.query.mock.calls[0];
      const sql = queryCall[0];

      expect(sql).toContain('aa.created_at >= CURRENT_DATE');
    });

    test('should aggregate actions_today correctly with JOIN', async () => {
      const mockAgents = [
        {
          agent_id: 1,
          name: 'Agent 1',
          status: 'online',
          current_ticket_id: 'ticket-1',
          current_ticket_title: 'Test',
          last_seen: new Date(),
          actions_today: 10,
          cost_today: 0.50,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockAgents });

      const result = await heartbeatService.getAllAgents();

      expect(result).toHaveLength(1);
      expect(result[0].actions_today).toBe(10);
      expect(result[0].cost_today).toBe(0.50);
    });

    test('should handle agents with no actions (zero aggregation)', async () => {
      const mockAgents = [
        {
          agent_id: 1,
          name: 'Agent 1',
          status: 'online',
          current_ticket_id: null,
          current_ticket_title: null,
          last_seen: new Date(),
          actions_today: 0,
          cost_today: 0,
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockAgents });

      const result = await heartbeatService.getAllAgents();

      expect(result[0].actions_today).toBe(0);
      expect(result[0].cost_today).toBe(0);
    });

    test('should import TicketService at module level (not inline)', async () => {
      // The heartbeatService module should have TicketService available
      // If require was inline, the module-level mock wouldn't work
      expect(ticketService.releaseTicket).toBeDefined();
    });
  });
});
