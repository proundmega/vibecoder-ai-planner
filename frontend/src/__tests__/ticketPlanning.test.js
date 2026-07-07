import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as ticketPlanning from '../api/ticketPlanning'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  put: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
}))

describe('ticketPlanning API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('listPlanningFiles', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ key: 'design.md', content: '# Design' }])

      const result = await ticketPlanning.listPlanningFiles('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning')
      expect(result).toEqual([{ key: 'design.md', content: '# Design' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await ticketPlanning.listPlanningFiles('ticket-1')

      expect(result).toEqual([])
    })
  })

  describe('getPlanningFile', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ key: 'design.md', content: '# Design' })

      const result = await ticketPlanning.getPlanningFile('ticket-1', 'design.md')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning/design.md')
      expect(result).toEqual({ key: 'design.md', content: '# Design' })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await ticketPlanning.getPlanningFile('ticket-1', 'design.md')

      expect(result).toBeNull()
    })
  })

  describe('upsertPlanningFile', () => {
    it('sends PUT request with content', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue({ key: 'design.md', content: '# Updated Design' })

      const result = await ticketPlanning.upsertPlanningFile('ticket-1', 'design.md', '# Updated Design')

      expect(put).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning/design.md', {
        content: '# Updated Design',
      })
      expect(result).toEqual({ key: 'design.md', content: '# Updated Design' })
    })
  })

  describe('applyTemplate', () => {
    it('sends POST request with templateName', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ applied: true, files: ['design.md', 'tasks.md'] })

      const result = await ticketPlanning.applyTemplate('ticket-1', 'feature')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning/apply-template', {
        templateName: 'feature',
      })
      expect(result).toEqual({ applied: true, files: ['design.md', 'tasks.md'] })
    })

    it('sends POST request with built-in template name "architecture"', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ applied: true, files: ['00_CHECKLIST.md', '01_REQUIREMENT.md'] })

      const result = await ticketPlanning.applyTemplate('ticket-1', 'architecture')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning/apply-template', {
        templateName: 'architecture',
      })
      expect(result).toEqual({ applied: true, files: ['00_CHECKLIST.md', '01_REQUIREMENT.md'] })
    })

    it('sends POST request with built-in template name "technical"', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ applied: true, files: ['01_TECHNICAL_REQUIREMENT.md'] })

      const result = await ticketPlanning.applyTemplate('ticket-1', 'technical')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning/apply-template', {
        templateName: 'technical',
      })
      expect(result).toEqual({ applied: true, files: ['01_TECHNICAL_REQUIREMENT.md'] })
    })
  })

  describe('updatePlanningStatus', () => {
    it('sends PATCH request with status', async () => {
      const { patch } = await import('../api/client')
      patch.mockResolvedValue({ status: 'in_progress' })

      const result = await ticketPlanning.updatePlanningStatus('ticket-1', 'in_progress')

      expect(patch).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/planning/status', {
        status: 'in_progress',
      })
      expect(result).toEqual({ status: 'in_progress' })
    })
  })
})
