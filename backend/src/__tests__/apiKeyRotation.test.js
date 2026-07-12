const AgentService = require('../services/AgentService');
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

jest.mock('../db', () => ({
  pool: { query: jest.fn() }
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

describe('AgentService - API Key Rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    bcrypt.compare.mockImplementation(async (key, hash) => {
      // For testing, we'll set up specific mock implementations per test
      return true;
    });
  });

  it('hashes api_key on agent creation (no plaintext stored)', async () => {
    const mockHash = '$2a$10$mockhash123456789012345678901234567890';
    bcrypt.hash.mockResolvedValue(mockHash);
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'test-agent', api_key_expires_at: new Date() }] });

    const plainKey = 'ak_test123';
    const result = await AgentService.create('test-agent', plainKey, 1);

    // The returned object should include the plaintext key (for the user to copy)
    expect(result.api_key).toBe(plainKey);

    // bcrypt.hash should have been called
    expect(bcrypt.hash).toHaveBeenCalledWith(plainKey, 10);

    // The query should NOT include api_key in the INSERT values
    const insertQuery = pool.query.mock.calls[0][0];
    expect(insertQuery).not.toContain('api_key,');
    expect(insertQuery).toContain('api_key_hash');
  });

  it('sets api_key_expires_at to 30 days from now', async () => {
    bcrypt.hash.mockResolvedValue('$2a$10$mockhash');
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'test-agent', api_key_expires_at: new Date() }] });

    const plainKey = 'ak_test123';
    await AgentService.create('test-agent', plainKey, 1);

    const queryArgs = pool.query.mock.calls[0][1];
    const expiresAt = queryArgs[2];
    const now = new Date();
    const thirtyDaysFromNow = new Date(now);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    expect(expiresAt).toBeInstanceOf(Date);
    const diff = Math.abs(expiresAt.getTime() - thirtyDaysFromNow.getTime());
    expect(diff).toBeLessThan(60000);
  });

  it('rotates key and invalidates old key (no plaintext stored)', async () => {
    bcrypt.hash.mockResolvedValue('$2a$10$mockhash');
    pool.query.mockResolvedValueOnce({ rows: [{ 
      id: 1, 
      name: 'test-agent', 
      api_key_expires_at: new Date()
    }] });

    const result = await AgentService.rotateKey(1, 1);

    expect(result.api_key).toBeDefined();

    // bcrypt.hash should have been called
    expect(bcrypt.hash).toHaveBeenCalled();

    // The query should NOT include api_key in the UPDATE SET
    const updateQuery = pool.query.mock.calls[0][0];
    expect(updateQuery).not.toContain('api_key =');
    expect(updateQuery).toContain('api_key_hash =');
  });

  it('throws error when rotating non-existent agent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(AgentService.rotateKey(999, 1)).rejects.toThrow('AGENT_NOT_FOUND');
  });

  it('getAgentByApiKey finds agent by hash comparison', async () => {
    bcrypt.compare.mockResolvedValueOnce(true);
    pool.query.mockResolvedValueOnce({ 
      rows: [{ 
        id: 1, 
        name: 'test-agent', 
        api_key_hash: '$2a$10$hash',
        provider_name: null,
        provider_type: null
      }] 
    });

    const agent = await AgentService.getAgentByApiKey('key-123');
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('test-agent');
    expect(bcrypt.compare).toHaveBeenCalledWith('key-123', '$2a$10$hash');
  });

  it('getAgentByApiKey returns null for wrong key', async () => {
    bcrypt.compare.mockResolvedValueOnce(false);
    pool.query.mockResolvedValueOnce({ 
      rows: [{ 
        id: 1, 
        name: 'test-agent', 
        api_key_hash: '$2a$10$hash',
        provider_name: null,
        provider_type: null
      }] 
    });

    const agent = await AgentService.getAgentByApiKey('wrong-key');
    expect(agent).toBeNull();
  });

  it('getAgentByApiKey skips agents with null hash (query filters them)', async () => {
    // The SQL query filters WHERE api_key_hash IS NOT NULL
    // So agents with null hash are never returned
    pool.query.mockResolvedValueOnce({ rows: [] });

    const agent = await AgentService.getAgentByApiKey('any_key');
    expect(agent).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('getAgentByApiKey tries all agents until match found', async () => {
    bcrypt.compare
      .mockResolvedValueOnce(false) // First agent doesn't match
      .mockResolvedValueOnce(true); // Second agent matches
    
    pool.query.mockResolvedValueOnce({ 
      rows: [
        { id: 1, name: 'Agent 1', api_key_hash: '$2a$10$hash1', provider_name: null, provider_type: null },
        { id: 2, name: 'Agent 2', api_key_hash: '$2a$10$hash2', provider_name: null, provider_type: null },
      ] 
    });

    const agent = await AgentService.getAgentByApiKey('key-123');
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('Agent 2');
    expect(bcrypt.compare).toHaveBeenCalledTimes(2);
  });
});
