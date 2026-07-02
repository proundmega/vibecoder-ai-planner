const auth = require('../middleware/auth');
const { pool } = require('../db');
const AgentService = require('../services/AgentService');

jest.mock('../db');
jest.mock('../services/AgentService');

describe('auth middleware', () => {
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

  describe('BP-51-08: requireActiveUser async/await', () => {
    test('should return 403 when user has no userId', async () => {
      mockReq.user = {};
      await auth.requireActiveUser(mockReq, mockRes, nextFn);
      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account deactivated' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should check is_active from database', async () => {
      mockReq.user = { userId: 1 };
      pool.query.mockResolvedValueOnce({ rows: [{ is_active: true }] });

      await auth.requireActiveUser(mockReq, mockRes, nextFn);

      expect(pool.query).toHaveBeenCalledWith(
        'SELECT is_active FROM users WHERE id = $1',
        [1]
      );
      expect(nextFn).toHaveBeenCalled();
    });

    test('should return 403 when user is not active', async () => {
      mockReq.user = { userId: 1 };
      pool.query.mockResolvedValueOnce({ rows: [{ is_active: false }] });

      await auth.requireActiveUser(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account deactivated' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should return 403 when user not found in database', async () => {
      mockReq.user = { userId: 999 };
      pool.query.mockResolvedValueOnce({ rows: [] });

      await auth.requireActiveUser(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account deactivated' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should return 403 on database error (no unhandled rejection)', async () => {
      mockReq.user = { userId: 1 };
      pool.query.mockRejectedValueOnce(new Error('DB connection failed'));

      await auth.requireActiveUser(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(403);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Account deactivated' });
      expect(nextFn).not.toHaveBeenCalled();
    });
  });

  describe('BP-51-09: agentAuth async/await', () => {
    test('should return 401 when no API key', async () => {
      await auth.agentAuth(mockReq, mockRes, nextFn);
      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing API key' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should accept test- prefixed API keys', async () => {
      mockReq.headers['x-api-key'] = 'test-key-123';
      await auth.agentAuth(mockReq, mockRes, nextFn);
      expect(mockReq.agent.id).toBe('mock-agent-1');
      expect(nextFn).toHaveBeenCalled();
    });

    test('should accept mock-agent-key', async () => {
      mockReq.headers['x-api-key'] = 'mock-agent-key';
      await auth.agentAuth(mockReq, mockRes, nextFn);
      expect(mockReq.agent.id).toBe('mock-agent-1');
      expect(nextFn).toHaveBeenCalled();
    });

    test('should look up real agent from database', async () => {
      mockReq.headers['x-api-key'] = 'real-api-key';
      const mockAgent = { id: 'agent-1', name: 'Real Agent', email: 'agent@test.com', role: 'member' };
      AgentService.getAgentByApiKey.mockResolvedValueOnce(mockAgent);

      await auth.agentAuth(mockReq, mockRes, nextFn);

      expect(AgentService.getAgentByApiKey).toHaveBeenCalledWith('real-api-key');
      expect(mockReq.agent).toEqual(mockAgent);
      expect(nextFn).toHaveBeenCalled();
    });

    test('should return 401 when agent not found', async () => {
      mockReq.headers['x-api-key'] = 'invalid-key';
      AgentService.getAgentByApiKey.mockResolvedValueOnce(null);

      await auth.agentAuth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should return 401 on agent service error (no unhandled rejection)', async () => {
      mockReq.headers['x-api-key'] = 'bad-key';
      AgentService.getAgentByApiKey.mockRejectedValueOnce(new Error('Service unavailable'));

      await auth.agentAuth(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid agent credentials' });
      expect(nextFn).not.toHaveBeenCalled();
    });
  });

  describe('BP-51-09: verifyTokenOrAgent async/await', () => {
    test('should prefer Bearer token over API key', async () => {
      mockReq.headers.authorization = 'Bearer valid-token';
      mockReq.headers['x-api-key'] = 'test-key';

      const mockVerifyToken = jest.fn((req, res, next) => {
        req.user = { userId: 'jwt-user' };
        next();
      });

      // Override verifyToken for this test
      const originalVerifyToken = auth.verifyToken;
      auth.verifyToken = mockVerifyToken;

      await auth.verifyTokenOrAgent(mockReq, mockRes, nextFn);

      expect(mockVerifyToken).toHaveBeenCalled();
      expect(nextFn).toHaveBeenCalled();

      auth.verifyToken = originalVerifyToken;
    });

    test('should accept test- prefixed API key as fallback', async () => {
      mockReq.headers['x-api-key'] = 'test-fallback';

      await auth.verifyTokenOrAgent(mockReq, mockRes, nextFn);

      expect(mockReq.agent.id).toBe('mock-agent-1');
      expect(mockReq.user.userId).toBe('mock-agent-1');
      expect(nextFn).toHaveBeenCalled();
    });

    test('should return 401 when no auth provided', async () => {
      await auth.verifyTokenOrAgent(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Missing authentication token' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should look up real agent from database', async () => {
      mockReq.headers['x-api-key'] = 'real-agent-key';
      const mockAgent = { id: 'agent-2', name: 'Agent Two', email: 'two@test.com', role: 'admin' };
      AgentService.getAgentByApiKey.mockResolvedValueOnce(mockAgent);

      await auth.verifyTokenOrAgent(mockReq, mockRes, nextFn);

      expect(AgentService.getAgentByApiKey).toHaveBeenCalledWith('real-agent-key');
      expect(mockReq.agent).toEqual(mockAgent);
      expect(mockReq.user.userId).toBe('agent-2');
      expect(mockReq.user.role).toBe('admin');
      expect(nextFn).toHaveBeenCalled();
    });

    test('should return 401 when real agent not found', async () => {
      mockReq.headers['x-api-key'] = 'unknown-key';
      AgentService.getAgentByApiKey.mockResolvedValueOnce(null);

      await auth.verifyTokenOrAgent(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid API key' });
      expect(nextFn).not.toHaveBeenCalled();
    });

    test('should return 401 on agent service error (no unhandled rejection)', async () => {
      mockReq.headers['x-api-key'] = 'bad-key';
      AgentService.getAgentByApiKey.mockRejectedValueOnce(new Error('Timeout'));

      await auth.verifyTokenOrAgent(mockReq, mockRes, nextFn);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Invalid agent credentials' });
      expect(nextFn).not.toHaveBeenCalled();
    });
  });
});
