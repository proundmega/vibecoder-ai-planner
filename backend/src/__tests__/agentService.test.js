const AgentService = require('../services/AgentService');
const { pool } = require('../db');

describe('AgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates agent with defaults', async () => {
      const mockRow = { id: 'a1', name: 'Test Agent', api_key: 'key-123', rate_limit: 100, max_actions_per_day: 1000 };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.create('Test Agent', 'key-123', 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        expect.arrayContaining(['Test Agent', 'key-123', 'user-1', 100, 1000])
      );
      expect(result).toEqual(mockRow);
    });
  });

  describe('list', () => {
    it('returns agents for user ordered by created_at DESC', async () => {
      const mockRows = [{ id: 'a1', name: 'Agent 1', owner_id: 'user-1' }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await AgentService.list('user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT agents.*'),
        ['user-1']
      );
      expect(result).toEqual(mockRows);
    });
  });

  describe('getApiKey', () => {
    it('returns api_key when agent exists', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ api_key: 'key-123' }] });

      const result = await AgentService.getApiKey('a1');

      expect(result).toBe('key-123');
    });

    it('returns null when agent not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AgentService.getApiKey('missing');

      expect(result).toBeNull();
    });
  });

  describe('revokeApiKey', () => {
    it('sets api_key to NULL', async () => {
      await AgentService.revokeApiKey('a1');

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE agents SET api_key = NULL WHERE id = $1',
        ['a1']
      );
    });
  });

  describe('registerAction', () => {
    it('inserts action with cost_incurred = 0.05', async () => {
      const mockRow = { id: 'aa1', agent_id: 'a1', action_type: 'create_ticket', cost_incurred: 0.05 };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.registerAction('a1', 'create_ticket', 'tickets', 't1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agent_actions'),
        ['a1', 'create_ticket', 'tickets', 't1', 0.05]
      );
      expect(result.cost_incurred).toBe(0.05);
    });
  });

  describe('getAgentDailyLimit', () => {
    it('returns used/available/limit with LEFT JOIN aggregate', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ rate_limit: 100, max_actions_per_day: 1000, actions_today: 50 }],
      });

      const result = await AgentService.getAgentDailyLimit('a1', new Date('2024-06-30'));

      expect(result.used).toBe(50);
      expect(result.available).toBe(950);
      expect(result.limit).toBe(1000);
      expect(result.resetAt).toBeDefined();
    });

    it('returns zero used when no actions today', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ rate_limit: 100, max_actions_per_day: 1000, actions_today: null }],
      });

      const result = await AgentService.getAgentDailyLimit('a1');

      expect(result.used).toBe(0);
      expect(result.available).toBe(1000);
    });

    it('returns defaults when agent not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AgentService.getAgentDailyLimit('missing');

      expect(result).toEqual({ available: 0, used: 0, limit: 100 });
    });
  });

  describe('getAgentHistory', () => {
    it('returns agent actions ordered by created_at DESC', async () => {
      const mockRows = [{ id: 'aa1', action_type: 'create_ticket' }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await AgentService.getAgentHistory('a1', 10);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM agent_actions'),
        ['a1', 10]
      );
      expect(result).toEqual(mockRows);
    });
  });

  describe('delete', () => {
    it('deletes agent by id', async () => {
      await AgentService.delete('a1');

      expect(pool.query).toHaveBeenCalledWith(
        'DELETE FROM agents WHERE id = $1',
        ['a1']
      );
    });
  });

  describe('getAgentByApiKey', () => {
    it('finds agent by exact api_key', async () => {
      const mockRow = { id: 'a1', name: 'Agent', api_key: 'key-123' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.getAgentByApiKey('key-123');

      expect(result).toEqual(mockRow);
    });

    it('returns undefined when no match', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AgentService.getAgentByApiKey('wrong-key');

      expect(result).toBeUndefined();
    });
  });

  describe('getAgentTickets', () => {
    it('returns tickets with nested subquery join', async () => {
      const mockRows = [{ id: 't1', title: 'Test', assignee_name: 'User' }];
      pool.query.mockResolvedValueOnce({ rows: mockRows });

      const result = await AgentService.getAgentTickets('a1', 'proj-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT t.*, u.name as assignee_name'),
        ['a1', 'proj-1']
      );
      expect(result).toEqual(mockRows);
    });
  });

  describe('incrementDailyUsage', () => {
    it('increments current_daily_usage by 1', async () => {
      await AgentService.incrementDailyUsage('a1');

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE agents SET current_daily_usage = current_daily_usage + 1 WHERE id = $1',
        ['a1']
      );
    });
  });
});
