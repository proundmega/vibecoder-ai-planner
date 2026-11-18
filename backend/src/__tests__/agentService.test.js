const AgentService = require('../services/AgentService');
const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$mockhash123456789012345678901234567890'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('AgentService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('creates agent with defaults (no plaintext key stored)', async () => {
      const mockRow = { id: 'a1', name: 'Test Agent', api_key_expires_at: new Date() };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.create('Test Agent', 'key-123', 'user-1');

      // Query should NOT include plaintext key
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        expect.arrayContaining(['Test Agent', '$2a$10$mockhash123456789012345678901234567890', '65803be0872fa538d3ac', expect.any(Date), 'user-1', null, 100, 1000])
      );
      // Result should include plaintext key for the user to copy
      expect(result.api_key).toBe('key-123');
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

    it('filters enrolled agents to their project', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await AgentService.list('user-1', { projectId: 3 });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('AND agents.project_id = $2'),
        ['user-1', 3]
      );
    });
  });

  describe('revokeApiKey', () => {
    it('locks the agent and clears the key inside one transaction', async () => {
      const client = {
        query: jest.fn(async sql => (
          sql.includes('SELECT id FROM agents') ? { rows: [{ id: 'a1' }] } : { rows: [] }
        )),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      await AgentService.revokeApiKey('a1');

      expect(client.query).toHaveBeenCalledWith('BEGIN');
      expect(client.query).toHaveBeenCalledWith(
        'SELECT id FROM agents WHERE id = $1 FOR UPDATE',
        ['a1']
      );
      expect(client.query).toHaveBeenCalledWith(
        'UPDATE agents SET api_key_hash = NULL, api_key_hash_prefix = NULL WHERE id = $1',
        ['a1']
      );
      expect(client.query).toHaveBeenCalledWith('COMMIT');
      expect(client.release).toHaveBeenCalled();
    });

    it('refuses to revoke a missing agent', async () => {
      const client = {
        query: jest.fn(async () => ({ rows: [] })),
        release: jest.fn(),
      };
      pool.connect.mockResolvedValueOnce(client);

      await expect(AgentService.revokeApiKey('missing')).rejects.toThrow('AGENT_NOT_FOUND');
      expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });
  });

  describe('registerAction', () => {
    it('inserts action record', async () => {
      const mockRow = { id: 1, agent_id: 'a1', action_type: 'test' };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.registerAction('a1', 'test', 'tickets', 't1');

      expect(result).toEqual(mockRow);
    });
  });

  describe('getAgentByApiKey', () => {
    it('finds agent by hash comparison with prefix lookup', async () => {
      bcrypt.compare.mockResolvedValueOnce(true);
      const mockRow = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_name: null, provider_type: null };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.getAgentByApiKey('key-123');

      expect(result).not.toBeNull();
      expect(result.name).toBe('Agent');
      // Should query by prefix
      expect(pool.query.mock.calls[0][0]).toContain('api_key_hash_prefix =');
    });

    it('returns null when no match', async () => {
      bcrypt.compare.mockResolvedValueOnce(false);
      const mockRow = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_name: null, provider_type: null };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.getAgentByApiKey('wrong-key');

      expect(result).toBeNull();
    });

    it('returns null when no candidates match prefix', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AgentService.getAgentByApiKey('any-key');

      expect(result).toBeNull();
      expect(bcrypt.compare).not.toHaveBeenCalled();
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

  describe('getAgentDailyLimit', () => {
    it('returns daily limit with correct parameters', async () => {
      const mockRow = { rate_limit: 200, max_actions_per_day: 5000, actions_today: 5 };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });
      const testDate = new Date('2026-01-15');

      const result = await AgentService.getAgentDailyLimit('a1', testDate);

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['a1', testDate]
      );
      expect(result.used).toBe(5);
      expect(result.limit).toBe(5000);
      expect(result.available).toBe(4995);
    });

    it('returns default when agent not found', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await AgentService.getAgentDailyLimit('nonexistent');

      expect(result.available).toBe(0);
      expect(result.used).toBe(0);
      expect(result.limit).toBe(100);
    });
  });

  describe('create with custom limits', () => {
    it('creates agent with custom rate limit and max actions', async () => {
      const mockRow = { id: 'a1', name: 'Custom Agent', api_key_expires_at: new Date() };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.create('Custom Agent', 'key-456', 'user-1', { providerId: 'prov-1', rateLimit: 500, maxActionsPerDay: 5000, keyExpiryDays: 60 });

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        expect.arrayContaining(['Custom Agent', expect.any(String), expect.any(String), expect.any(Date), 'user-1', 'prov-1', 500, 5000])
      );
      expect(result.api_key).toBe('key-456');
    });

    it('creates agent with defaults when no options provided', async () => {
      const mockRow = { id: 'a1', name: 'Default Agent', api_key_expires_at: new Date() };
      pool.query.mockResolvedValueOnce({ rows: [mockRow] });

      const result = await AgentService.create('Default Agent', 'key-789', 'user-1');

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        expect.arrayContaining([expect.any(String), expect.any(String), expect.any(String), expect.any(Date), 'user-1', null, 100, 1000])
      );
      expect(result.api_key).toBe('key-789');
    });
  });
});
