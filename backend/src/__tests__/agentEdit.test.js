const request = require('supertest');
const app = require('../index');
const AgentService = require('../services/AgentService');
const bcrypt = require('bcryptjs');

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

describe('Agent Edit & Provider Config — Route Level', () => {
  let updateNameSpy;
  let getProviderConfigSpy;
  let callCount;

  beforeEach(() => {
    jest.clearAllMocks()
    callCount = 0
    updateNameSpy = jest.spyOn(AgentService, 'updateName').mockResolvedValue({ id: 'a1', name: 'New Name', updated_at: new Date() })
    getProviderConfigSpy = jest.spyOn(AgentService, 'getProviderConfig').mockResolvedValue({ success: true, data: { provider_type: 'claude', api_key: 'decrypted-key', base_url: null, model: 'claude-sonnet-4-20250514', max_tokens: 4096 } })
  })

  describe('PUT /api/v1/agents/:agentId', () => {
    it('returns 200 with updated agent name', async () => {
      const res = await request(app)
        .put('/api/v1/agents/a1')
        .set('Authorization', 'Bearer mock-token')
        .send({ name: 'New Name' })

      expect(res.statusCode).toBe(200)
      expect(res.body.name).toBe('New Name')
      expect(updateNameSpy).toHaveBeenCalledWith('a1', 'New Name', 'user-1')
    })

    it('returns 400 on empty name', async () => {
      const res = await request(app)
        .put('/api/v1/agents/a1')
        .set('Authorization', 'Bearer mock-token')
        .send({ name: '' })

      expect(res.statusCode).toBe(400)
      expect(updateNameSpy).not.toHaveBeenCalled()
    })

    it('returns 404 when agent does not belong to user', async () => {
      updateNameSpy.mockRejectedValue(new Error('AGENT_NOT_FOUND'))

      const res = await request(app)
        .put('/api/v1/agents/a1')
        .set('Authorization', 'Bearer mock-token')
        .send({ name: 'New Name' })

      expect(res.statusCode).toBe(404)
    })
  })

  describe('GET /api/v1/agents/:agentId/provider-config', () => {
    it('returns 401 when X-API-Key header is missing', async () => {
      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')

      expect(res.statusCode).toBe(401)
      expect(getProviderConfigSpy).not.toHaveBeenCalled()
    })

    it('returns 404 when agent not found by API key', async () => {
      getProviderConfigSpy.mockRejectedValue(new Error('AGENT_NOT_FOUND'))

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'wrong-key')

      expect(res.statusCode).toBe(404)
    })

    it('returns 404 when agent has no provider', async () => {
      getProviderConfigSpy.mockRejectedValue(new Error('NO_PROVIDER'))

      const res = await request(app)
        .get('/api/v1/agents/a1/provider-config')
        .set('X-API-Key', 'test-key')

      expect(res.statusCode).toBe(404)
    })
  })
})

describe('Agent Edit & Provider Config — Service Level', () => {
  describe('updateName', () => {
    it('updates agent name and returns updated record', async () => {
      const mockRow = { id: 'a1', name: 'New Name', updated_at: new Date() }
      pool.query.mockImplementation(() => Promise.resolve({ rows: [mockRow] }))

      const result = await AgentService.updateName('a1', 'New Name', 'user-1')

      expect(result.name).toBe('New Name')
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agents SET name'),
        ['New Name', 'a1', 'user-1']
      )
    })

    it('throws AGENT_NOT_FOUND when agent does not belong to user', async () => {
      pool.query.mockImplementation(() => Promise.resolve({ rows: [] }))

      await expect(AgentService.updateName('a1', 'New Name', 'user-2'))
        .rejects.toThrow('AGENT_NOT_FOUND')
    })
  })

  describe('getProviderConfig', () => {
    it('returns decrypted provider config when agent has provider', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: 'prov-1' }
      const mockProvider = { provider_type: 'claude', api_key_encrypted: 'encrypted-key', base_url: null, model: 'claude-sonnet-4-20250514', max_tokens: 4096 }

      let queryCount = 0
      pool.query.mockImplementation(() => {
        queryCount++
        if (queryCount === 1) {
          return Promise.resolve({ rows: [mockAgent] }) // getAgentByApiKey prefix lookup
        }
        return Promise.resolve({ rows: [mockProvider] }) // provider fetch
      })

      const result = await AgentService.getProviderConfig('a1', 'test-key')

      expect(result.success).toBe(true)
      expect(result.data.provider_type).toBe('claude')
      expect(result.data.model).toBe('claude-sonnet-4-20250514')
    })

    it('throws AGENT_NOT_FOUND when agent not found by API key', async () => {
      pool.query.mockImplementation(() => Promise.resolve({ rows: [] }))

      await expect(AgentService.getProviderConfig('a1', 'wrong-key'))
        .rejects.toThrow('AGENT_NOT_FOUND')
    })

    it('throws NO_PROVIDER when agent has no provider_id', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: null }
      let queryCount = 0
      pool.query.mockImplementation(() => {
        queryCount++
        if (queryCount === 1) {
          return Promise.resolve({ rows: [mockAgent] }) // getAgentByApiKey prefix lookup
        }
        return Promise.resolve({ rows: [] })
      })

      await expect(AgentService.getProviderConfig('a1', 'test-key'))
        .rejects.toThrow('NO_PROVIDER')
    })
  })
})
