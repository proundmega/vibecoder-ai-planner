import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as providers from '../api/providers'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

describe('providers API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('listProviders', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'p1', name: 'OpenAI' }])

      const result = await providers.listProviders()

      expect(get).toHaveBeenCalledWith('/api/v1/providers')
      expect(result).toEqual([{ id: 'p1', name: 'OpenAI' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await providers.listProviders()

      expect(result).toEqual([])
    })
  })

  describe('addProvider', () => {
    it('sends POST request with correct data', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'p1', name: 'OpenAI', providerType: 'openai' })

      const result = await providers.addProvider({
        name: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-xxx',
        model: 'gpt-4o',
      })

      expect(post).toHaveBeenCalledWith('/api/v1/providers', {
        name: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-xxx',
        model: 'gpt-4o',
      })
      expect(result).toEqual({ id: 'p1', name: 'OpenAI', providerType: 'openai' })
    })
  })

  describe('getProvider', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ id: 'p1', name: 'OpenAI' })

      const result = await providers.getProvider('p1')

      expect(get).toHaveBeenCalledWith('/api/v1/providers/p1')
      expect(result).toEqual({ id: 'p1', name: 'OpenAI' })
    })
  })

  describe('updateProvider', () => {
    it('sends PATCH request with updates', async () => {
      const { patch } = await import('../api/client')
      patch.mockResolvedValue({ id: 'p1', name: 'Updated Name' })

      const result = await providers.updateProvider('p1', { name: 'Updated Name' })

      expect(patch).toHaveBeenCalledWith('/api/v1/providers/p1', {
        name: 'Updated Name',
      })
      expect(result).toEqual({ id: 'p1', name: 'Updated Name' })
    })
  })

  describe('deleteProvider', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await providers.deleteProvider('p1')

      expect(del).toHaveBeenCalledWith('/api/v1/providers/p1')
      expect(result).toEqual({ deleted: true })
    })
  })

  describe('testProvider', () => {
    it('sends POST request to correct URL', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ success: true, valid: true, message: 'Connected' })

      const result = await providers.testProvider('p1')

      expect(post).toHaveBeenCalledWith('/api/v1/providers/p1/test')
      expect(result).toEqual({ success: true, valid: true, message: 'Connected' })
    })
  })

  describe('setDirector', () => {
    it('sends PATCH request to correct URL', async () => {
      const { patch } = await import('../api/client')
      patch.mockResolvedValue({ id: 'p1', name: 'OpenAI', is_project_director: true })

      const result = await providers.setDirector('p1')

      expect(patch).toHaveBeenCalledWith('/api/v1/providers/p1/directorship')
      expect(result).toEqual({ id: 'p1', name: 'OpenAI', is_project_director: true })
    })
  })

  describe('getProviderAgents', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 1, name: 'Agent 1', provider_id: 'p1' }])

      const result = await providers.getProviderAgents('p1')

      expect(get).toHaveBeenCalledWith('/api/v1/providers/p1/agents')
      expect(result).toEqual([{ id: 1, name: 'Agent 1', provider_id: 'p1' }])
    })
  })

  describe('resolveProvider', () => {
    it('sends POST request with input', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ provider: 'p1', model: 'gpt-4o' })

      const result = await providers.resolveProvider({ labels: ['code-review'], priority: 'high' })

      expect(post).toHaveBeenCalledWith('/api/v1/providers/resolve', {
        labels: ['code-review'],
        priority: 'high',
      })
      expect(result).toEqual({ provider: 'p1', model: 'gpt-4o' })
    })
  })
})
