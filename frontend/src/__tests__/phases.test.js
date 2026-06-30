import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as phases from '../api/phases'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

describe('phases API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('fetchPhases', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ success: true, data: { phase: 'in_progress', allowed: ['review', 'backlog'] } })

      const result = await phases.fetchPhases('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/current')
      expect(result).toEqual({ success: true, data: { phase: 'in_progress', allowed: ['review', 'backlog'] } })
    })
  })

  describe('fetchAllowedPhases', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ success: true, data: { allowed: ['review', 'backlog'] } })

      const result = await phases.fetchAllowedPhases('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/allowed')
      expect(result).toEqual({ success: true, data: { allowed: ['review', 'backlog'] } })
    })
  })

  describe('fetchPhaseHistory', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      const history = [
        { to_phase: 'draft', actor_type: 'human', created_at: '2024-01-01T00:00:00Z' },
        { to_phase: 'in_progress', actor_type: 'human', created_at: '2024-01-02T00:00:00Z' },
      ]
      get.mockResolvedValue({ success: true, data: history })

      const result = await phases.fetchPhaseHistory('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases')
      expect(result).toEqual({ success: true, data: history })
    })
  })

  describe('transitionPhase', () => {
    it('sends POST request with correct data', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ success: true, data: { phase: 'review' } })

      await phases.transitionPhase('ticket-1', 'review', {}, 'human')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'review',
        actorType: 'human',
        metadata: null,
      })
    })

    it('includes metadata when provided', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ success: true, data: { phase: 'done' } })

      await phases.transitionPhase('ticket-1', 'done', { reason: 'all tests pass' }, 'human')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'done',
        actorType: 'human',
        metadata: { reason: 'all tests pass' },
      })
    })

    it('defaults actorType to human', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ success: true, data: { phase: 'review' } })

      await phases.transitionPhase('ticket-1', 'review')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'review',
        actorType: 'human',
        metadata: null,
      })
    })

    it('uses provided actorType', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ success: true, data: { phase: 'review' } })

      await phases.transitionPhase('ticket-1', 'review', {}, 'agent')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'review',
        actorType: 'agent',
        metadata: null,
      })
    })
  })
})
