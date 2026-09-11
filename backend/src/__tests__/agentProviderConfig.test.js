const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');

jest.mock('../db', () => ({
  pool: {
    query: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((val) => 'decrypted-' + val),
  encrypt: jest.fn(),
  maskToken: jest.fn(),
}));

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$mockhash123456789012345678901234567890'),
  compare: jest.fn().mockResolvedValue(true),
}));

jest.mock('jsonwebtoken', () => ({
  verify: jest.fn().mockReturnValue({ userId: 'user-1', email: 'user@test.com', role: 'member' }),
  sign: jest.fn().mockReturnValue('mock-token'),
}));

jest.mock('../services/PermissionService', () => ({
  hasAnyPermission: jest.fn().mockResolvedValue(true),
  hasAllPermissions: jest.fn().mockResolvedValue(true),
}));

const { pool } = require('../db');

describe('Agent Provider Config — Double-Wrap Regression Test', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('service level: getProviderConfig returns flat object', () => {
    it('returns flat object with provider fields (not double-wrapped)', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: 'prov-1' }
      const mockProvider = { provider_type: 'claude', api_key_encrypted: 'encrypted-key', base_url: null, model: 'claude-sonnet-4', max_tokens: 4096 }

      let queryCount = 0
      pool.query.mockImplementation(() => {
        queryCount++
        if (queryCount === 1) {
          return Promise.resolve({ rows: [mockAgent] })
        }
        return Promise.resolve({ rows: [mockProvider] })
      })

      const result = await AgentService.getProviderConfig('a1', 'test-key')

      // CRITICAL: result must NOT have { success, data } wrapper
      expect(result).not.toHaveProperty('success')
      expect(result).not.toHaveProperty('data')
      expect(result.provider_type).toBe('claude')
      expect(result.api_key).toBe('decrypted-encrypted-key')
      expect(result.model).toBe('claude-sonnet-4')
      expect(result.max_tokens).toBe(4096)
    })

    it('returns null api_key when provider has no encrypted key', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: 'prov-1' }
      const mockProvider = { provider_type: 'openai', api_key_encrypted: null, base_url: null, model: 'gpt-4', max_tokens: 2048 }

      let queryCount = 0
      pool.query.mockImplementation(() => {
        queryCount++
        if (queryCount === 1) {
          return Promise.resolve({ rows: [mockAgent] })
        }
        return Promise.resolve({ rows: [mockProvider] })
      })

      const result = await AgentService.getProviderConfig('a1', 'test-key')

      expect(result.provider_type).toBe('openai')
      expect(result.api_key).toBeNull()
    })

    it('throws AGENT_NOT_FOUND when agent not found by API key', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] })

      await expect(AgentService.getProviderConfig('a1', 'wrong-key'))
        .rejects.toThrow('AGENT_NOT_FOUND')
    })

    it('throws NO_PROVIDER when agent has no provider_id', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: null }
      pool.query.mockResolvedValueOnce({ rows: [mockAgent] })

      await expect(AgentService.getProviderConfig('a1', 'test-key'))
        .rejects.toThrow('NO_PROVIDER')
    })

    it('throws PROVIDER_NOT_FOUND when provider does not exist', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: 'nonexistent' }
      pool.query.mockResolvedValueOnce({ rows: [mockAgent] })
      pool.query.mockResolvedValueOnce({ rows: [] })

      await expect(AgentService.getProviderConfig('a1', 'test-key'))
        .rejects.toThrow('PROVIDER_NOT_FOUND')
    })
  })

  describe('route level: GET /agents/:agentId/provider-config', () => {
    it('returns 200 with single-wrapped { success, data } from route handler', async () => {
      const flatConfig = {
        provider_type: 'claude',
        api_key: 'decrypted-key',
        base_url: null,
        model: 'claude-sonnet-4',
        max_tokens: 4096,
      }
      jest.spyOn(AgentService, 'getProviderConfig').mockResolvedValue(flatConfig)

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'test-key')

      expect(res.statusCode).toBe(200)
      expect(res.body.success).toBe(true)
      expect(res.body.data.provider_type).toBe('claude')
      expect(res.body.data.model).toBe('claude-sonnet-4')
      // CRITICAL: data should NOT be double-wrapped
      expect(res.body.data).not.toHaveProperty('success')
      expect(res.body.data).not.toHaveProperty('data')
    })

    it('returns 401 without X-API-Key header', async () => {
      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')

      expect(res.statusCode).toBe(401)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('MISSING_API_KEY')
    })

    it('returns 404 when agent not found', async () => {
      jest.spyOn(AgentService, 'getProviderConfig').mockRejectedValue(new Error('AGENT_NOT_FOUND'))

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'wrong-key')

      expect(res.statusCode).toBe(404)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('AGENT_NOT_FOUND')
    })

    it('returns 404 when agent has no provider', async () => {
      jest.spyOn(AgentService, 'getProviderConfig').mockRejectedValue(new Error('NO_PROVIDER'))

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'test-key')

      expect(res.statusCode).toBe(404)
      expect(res.body.success).toBe(false)
      expect(res.body.error.code).toBe('NO_PROVIDER')
    })
  })
})
