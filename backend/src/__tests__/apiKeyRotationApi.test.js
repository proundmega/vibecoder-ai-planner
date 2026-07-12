const auth = require('../middleware/auth');
const { pool } = require('../db');
const AgentService = require('../services/AgentService');

jest.mock('../db');
jest.mock('../services/AgentService', () => ({
  getAgentByApiKey: jest.fn(),
}));

describe('Agent Key Rotation - Middleware', () => {
  let mockReq, mockRes, nextFn;

  beforeEach(() => {
    jest.clearAllMocks();
    nextFn = jest.fn();
    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    mockReq = {
      headers: {},
      user: null,
      agent: null,
    };
  });

  it('returns 401 with KEY_EXPIRED for expired key', async () => {
    const expiredDate = new Date(Date.now() - 86400000);
    const mockAgent = {
      id: 1,
      name: 'test-agent',
      api_key: 'ak_test123',
      api_key_hash: '$2a$10$hash',
      api_key_expires_at: expiredDate,
    };
    AgentService.getAgentByApiKey.mockResolvedValue(mockAgent);

    mockReq.headers['x-api-key'] = 'ak_test123';
    await auth.agentAuth(mockReq, mockRes, nextFn);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({
      error: {
        code: 'KEY_EXPIRED',
        message: expect.stringContaining('expired'),
        expiredAt: expiredDate,
      },
    });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('allows valid key with correct hash', async () => {
    const bcrypt = require('bcryptjs');
    const validKey = 'ak_valid123';
    const hash = await bcrypt.hash(validKey, 10);
    const futureDate = new Date(Date.now() + 86400000);
    const mockAgent = {
      id: 1,
      name: 'test-agent',
      api_key: validKey,
      api_key_hash: hash,
      api_key_expires_at: futureDate,
    };
    AgentService.getAgentByApiKey.mockResolvedValue(mockAgent);

    mockReq.headers['x-api-key'] = validKey;
    await auth.agentAuth(mockReq, mockRes, nextFn);

    expect(nextFn).toHaveBeenCalled();
    expect(mockReq.agent).toEqual(mockAgent);
  });

  it('returns 401 when no API key provided', async () => {
    await auth.agentAuth(mockReq, mockRes, nextFn);

    expect(mockRes.status).toHaveBeenCalledWith(401);
    expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing API key' });
    expect(nextFn).not.toHaveBeenCalled();
  });

  it('bypasses expiry check for test- prefixed keys', async () => {
    mockReq.headers['x-api-key'] = 'test-key-123';
    await auth.agentAuth(mockReq, mockRes, nextFn);

    expect(nextFn).toHaveBeenCalled();
    expect(mockReq.agent.id).toBe('mock-agent-1');
  });
});
