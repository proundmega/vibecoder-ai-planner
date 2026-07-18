const AgentService = require('../services/AgentService');
const { pool } = require('../db');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

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
    bcrypt.compare.mockImplementation(async (_key, _hash) => true);
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
    expect(insertQuery).toContain('api_key_hash_prefix');

    // Query args: name, hash, prefix, expiresAt, userId, providerId, rateLimit, maxActions
    const queryArgs = pool.query.mock.calls[0][1];
    expect(queryArgs[0]).toBe('test-agent');
    expect(queryArgs[1]).toBe(mockHash);
    const expectedPrefix = crypto.createHash('sha256').update(plainKey).digest('hex').substring(0, 20);
    expect(queryArgs[2]).toBe(expectedPrefix);
  });

  it('sets api_key_expires_at to 30 days from now', async () => {
    bcrypt.hash.mockResolvedValue('$2a$10$mockhash');
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'test-agent', api_key_expires_at: new Date() }] });

    const plainKey = 'ak_test123';
    await AgentService.create('test-agent', plainKey, 1);

    const queryArgs = pool.query.mock.calls[0][1];
    const expiresAt = queryArgs[3];
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
    expect(updateQuery).toContain('api_key_hash_prefix =');
  });

  it('throws error when rotating non-existent agent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(AgentService.rotateKey(999, 1)).rejects.toThrow('AGENT_NOT_FOUND');
  });

  it('getAgentByApiKey uses prefix lookup for O(1) candidate selection', async () => {
    const mockHash = '$2a$10$prefix123456789012345678901234567890';
    bcrypt.hash.mockResolvedValue(mockHash);
    bcrypt.compare.mockResolvedValueOnce(true);
    
    pool.query.mockResolvedValueOnce({ 
      rows: [{ 
        id: 1, 
        name: 'test-agent', 
        api_key_hash: mockHash,
        provider_name: null,
        provider_type: null
      }] 
    });

    const agent = await AgentService.getAgentByApiKey('key-123');
    expect(agent).not.toBeNull();
    expect(agent.name).toBe('test-agent');

    // Should query by prefix, not by full hash or IS NOT NULL
    const query = pool.query.mock.calls[0][0];
    expect(query).toContain('api_key_hash_prefix =');
    expect(query).not.toContain('api_key_hash IS NOT NULL');

    // Should pass prefix as parameter
    const queryArgs = pool.query.mock.calls[0][1];
    const expectedPrefix = crypto.createHash('sha256').update('key-123').digest('hex').substring(0, 20);
    expect(queryArgs[0]).toBe(expectedPrefix);
  });

  it('getAgentByApiKey returns null for wrong key', async () => {
    bcrypt.hash.mockResolvedValue('$2a$10$wrongkey123456789012345678901234567890');
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

  it('getAgentByApiKey returns null when no candidates match prefix', async () => {
    bcrypt.hash.mockResolvedValue('$2a$10$nonexistent123456789012345678901234567890');
    pool.query.mockResolvedValueOnce({ rows: [] });

    const agent = await AgentService.getAgentByApiKey('any_key');
    expect(agent).toBeNull();
    expect(bcrypt.compare).not.toHaveBeenCalled();
  });

  it('getAgentByApiKey verifies with bcrypt.compare after prefix lookup', async () => {
    const mockHash = '$2a$10$prefix123456789012345678901234567890';
    bcrypt.hash.mockResolvedValue(mockHash);
    bcrypt.compare.mockResolvedValueOnce(false); // Prefix matches but hash doesn't
    
    pool.query.mockResolvedValueOnce({ 
      rows: [{ 
        id: 1, 
        name: 'test-agent', 
        api_key_hash: '$2a$10$differenthash1234567890123456789012345678',
        provider_name: null,
        provider_type: null
      }] 
    });

    const agent = await AgentService.getAgentByApiKey('key-123');
    expect(agent).toBeNull();
    expect(bcrypt.compare).toHaveBeenCalled();
  });
});
