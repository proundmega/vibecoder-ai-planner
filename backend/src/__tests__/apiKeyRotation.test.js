const AgentService = require('../services/AgentService');
const { pool } = require('../db');
const bcrypt = require('bcryptjs');

jest.mock('../db', () => ({
  pool: { query: jest.fn() }
}));

describe('AgentService - API Key Rotation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hashes api_key on agent creation', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'test-agent', api_key: 'ak_test123', api_key_expires_at: new Date() }] });

    const plainKey = 'ak_test123';
    const result = await AgentService.create('test-agent', plainKey, 1);

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('api_key_hash'),
      expect.arrayContaining([expect.any(String)])
    );
    const hashArg = pool.query.mock.calls[0][2];
    const valid = await bcrypt.compare(plainKey, hashArg);
    expect(valid).toBe(true);
  });

  it('sets api_key_expires_at to 30 days from now', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 1, name: 'test-agent', api_key: 'ak_test123', api_key_expires_at: new Date() }] });

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

  it('rotates key and invalidates old key', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ 
      id: 1, 
      name: 'test-agent', 
      api_key: 'ak_new456', 
      api_key_expires_at: new Date(),
      apiKey: 'ak_new456'
    }] });

    const result = await AgentService.rotateKey(1, 1);

    expect(result.apiKey).toBeDefined();

    const newKey = result.apiKey;
    const queryArgs = pool.query.mock.calls[0][1];
    const newHash = queryArgs[1];
    const valid = await bcrypt.compare(newKey, newHash);
    expect(valid).toBe(true);
  });

  it('throws error when rotating non-existent agent', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await expect(AgentService.rotateKey(999, 1)).rejects.toThrow('AGENT_NOT_FOUND');
  });
});
