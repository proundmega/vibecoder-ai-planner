import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as memory from '../api/memory'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

describe('memory API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getProjectMemory', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'm1', content: 'test' }])

      const result = await memory.getProjectMemory('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/memory/project/proj-123')
      expect(result).toEqual([{ id: 'm1', content: 'test' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await memory.getProjectMemory('proj-123')

      expect(result).toEqual([])
    })
  })

  describe('searchMemory', () => {
    it('sends GET request with query params in URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'm1', content: 'relevant' }])

      const result = await memory.searchMemory('proj-123', 'bug')

      expect(get).toHaveBeenCalledWith('/api/v1/memory/project/proj-123/search?query=bug')
      expect(result).toEqual([{ id: 'm1', content: 'relevant' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await memory.searchMemory('proj-123', 'anything')

      expect(result).toEqual([])
    })
  })

  describe('getAgentMemory', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'm1', content: 'agent memory' }])

      const result = await memory.getAgentMemory('agent-1')

      expect(get).toHaveBeenCalledWith('/api/v1/memory/agent/agent-1')
      expect(result).toEqual([{ id: 'm1', content: 'agent memory' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await memory.getAgentMemory('agent-1')

      expect(result).toEqual([])
    })
  })

  describe('getMemory', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ id: 'm1', content: 'content' })

      const result = await memory.getMemory('m1')

      expect(get).toHaveBeenCalledWith('/api/v1/memory/m1')
      expect(result).toEqual({ id: 'm1', content: 'content' })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await memory.getMemory('m1')

      expect(result).toBeNull()
    })
  })

  describe('addMemory', () => {
    it('sends POST request with content and metadata', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'm1', content: 'new memory' })

      const result = await memory.addMemory('proj-123', 'new memory', { key: 'val' })

      expect(post).toHaveBeenCalledWith('/api/v1/memory/project/proj-123', {
        content: 'new memory',
        metadata: { key: 'val' },
      })
      expect(result).toEqual({ id: 'm1', content: 'new memory' })
    })
  })

  describe('updateMemory', () => {
    it('sends PUT request with updates', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue({ id: 'm1', content: 'updated' })

      const result = await memory.updateMemory('m1', { content: 'updated' })

      expect(put).toHaveBeenCalledWith('/api/v1/memory/m1', { content: 'updated' })
      expect(result).toEqual({ id: 'm1', content: 'updated' })
    })
  })

  describe('deleteMemory', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await memory.deleteMemory('m1')

      expect(del).toHaveBeenCalledWith('/api/v1/memory/m1')
      expect(result).toEqual({ deleted: true })
    })
  })
})
