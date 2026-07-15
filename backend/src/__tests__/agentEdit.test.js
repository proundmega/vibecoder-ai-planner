jest.mock('../utils/crypto', () => ({
  decrypt: jest.fn((val) => 'decrypted-' + val),
  encrypt: jest.fn(),
  maskToken: jest.fn(),
}))

const AgentService = require('../services/AgentService')
const { pool } = require('../db')
const bcrypt = require('bcryptjs')

jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2a$10$mockhash123456789012345678901234567890'),
  compare: jest.fn().mockResolvedValue(true),
}))

describe('Agent Edit & Provider Config', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('updateName', () => {
    it('updates agent name and returns updated record', async () => {
      const mockRow = { id: 'a1', name: 'New Name', updated_at: new Date() }
      pool.query.mockResolvedValueOnce({ rows: [mockRow] })

      const result = await AgentService.updateName('a1', 'New Name', 'user-1')

      expect(result.name).toBe('New Name')
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE agents SET name'),
        ['New Name', 'a1', 'user-1']
      )
    })

    it('throws AGENT_NOT_FOUND when agent does not belong to user', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] })

      await expect(AgentService.updateName('a1', 'New Name', 'user-2'))
        .rejects.toThrow('AGENT_NOT_FOUND')
    })
  })

  describe('getProviderConfig', () => {
    it('returns decrypted provider config when agent has provider', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: 'prov-1' }
      const mockProvider = { provider_type: 'claude', api_key_encrypted: 'encrypted-key', base_url: null, model: 'claude-sonnet-4-20250514', max_tokens: 4096 }

      pool.query
        .mockResolvedValueOnce({ rows: [mockAgent] }) // prefix lookup
        .mockResolvedValueOnce({ rows: [mockProvider] }) // provider fetch

      const result = await AgentService.getProviderConfig('a1', 'test-key')

      expect(result.success).toBe(true)
      expect(result.data.provider_type).toBe('claude')
      expect(result.data.model).toBe('claude-sonnet-4-20250514')
    })

    it('throws AGENT_NOT_FOUND when agent not found by API key', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] }) // prefix lookup returns nothing

      await expect(AgentService.getProviderConfig('a1', 'wrong-key'))
        .rejects.toThrow('AGENT_NOT_FOUND')
    })

    it('throws NO_PROVIDER when agent has no provider_id', async () => {
      const mockAgent = { id: 'a1', name: 'Agent', api_key_hash: '$2a$10$hash', provider_id: null }
      pool.query.mockResolvedValueOnce({ rows: [mockAgent] })

      await expect(AgentService.getProviderConfig('a1', 'test-key'))
        .rejects.toThrow('NO_PROVIDER')
    })
  })

  describe('revokeApiKey', () => {
    it('sets api_key_hash to NULL', async () => {
      await AgentService.revokeApiKey('a1')

      expect(pool.query).toHaveBeenCalledWith(
        'UPDATE agents SET api_key_hash = NULL, api_key_hash_prefix = NULL WHERE id = $1',
        ['a1']
      )
    })
  })
})
