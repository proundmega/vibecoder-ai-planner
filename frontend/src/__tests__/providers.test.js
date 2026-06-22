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

      const result = await providers.listProviders('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/providers/proj-123/providers')
      expect(result).toEqual([{ id: 'p1', name: 'OpenAI' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await providers.listProviders('proj-123')

      expect(result).toEqual([])
    })
  })

  describe('addProvider', () => {
    it('sends POST request with correct data', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'p1', name: 'OpenAI', providerType: 'openai' })

      const result = await providers.addProvider('proj-123', 'OpenAI', 'openai', 'sk-xxx')

      expect(post).toHaveBeenCalledWith('/api/v1/providers/proj-123/providers', {
        name: 'OpenAI',
        providerType: 'openai',
        apiKey: 'sk-xxx',
      })
      expect(result).toEqual({ id: 'p1', name: 'OpenAI', providerType: 'openai' })
    })
  })

  describe('updateProvider', () => {
    it('sends PATCH request with updates', async () => {
      const { patch } = await import('../api/client')
      patch.mockResolvedValue({ id: 'p1', name: 'Updated Name' })

      const result = await providers.updateProvider('proj-123', 'prov-1', { name: 'Updated Name' })

      expect(patch).toHaveBeenCalledWith('/api/v1/providers/proj-123/providers/prov-1', {
        name: 'Updated Name',
      })
      expect(result).toEqual({ id: 'p1', name: 'Updated Name' })
    })
  })

  describe('deleteProvider', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await providers.deleteProvider('proj-123', 'prov-1')

      expect(del).toHaveBeenCalledWith('/api/v1/providers/proj-123/providers/prov-1')
      expect(result).toEqual({ deleted: true })
    })
  })

  describe('testProvider', () => {
    it('sends POST request to correct URL', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ success: true, message: 'Connected' })

      const result = await providers.testProvider('proj-123', 'prov-1')

      expect(post).toHaveBeenCalledWith('/api/v1/providers/proj-123/providers/prov-1/test')
      expect(result).toEqual({ success: true, message: 'Connected' })
    })
  })
})
