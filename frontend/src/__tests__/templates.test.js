import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as templates from '../api/templates'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

describe('templates API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('listTemplates', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ success: true, data: [{ id: 't1', name: 'Test' }] })

      const result = await templates.listTemplates('proj-1')

      expect(get).toHaveBeenCalledWith('/api/v1/projects/proj-1/templates')
      expect(result).toEqual({ success: true, data: [{ id: 't1', name: 'Test' }] })
    })

    it('throws on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('fail'))

      await expect(templates.listTemplates('proj-1')).rejects.toThrow('fail')
    })
  })

  describe('createTemplate', () => {
    it('sends POST request with correct data', async () => {
      const { post } = await import('../api/client')
      const data = {
        name: 'New Template',
        file_definitions: [{ key: 'test.md', content: 'content' }],
      }
      post.mockResolvedValue({ success: true, data: { id: 't1' } })

      await templates.createTemplate('proj-1', data)

      expect(post).toHaveBeenCalledWith('/api/v1/projects/proj-1/templates', data)
    })
  })

  describe('deleteTemplate', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ success: true, data: { id: 't1' } })

      await templates.deleteTemplate('proj-1', 't1')

      expect(del).toHaveBeenCalledWith('/api/v1/projects/proj-1/templates/t1')
    })
  })
})
