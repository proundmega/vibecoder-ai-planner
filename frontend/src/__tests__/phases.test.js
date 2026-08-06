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
      get.mockResolvedValue({ phase: 'in_progress' })

      const result = await phases.fetchPhases('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/current')
      expect(result).toEqual({ phase: 'in_progress' })
    })

    it('[R4] returns { phase } (post-extractData shape)', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ phase: 'in_progress' })

      const result = await phases.fetchPhases('t1')

      expect(result).toEqual({ phase: 'in_progress' })
    })
  })

  describe('fetchAllowedPhases', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ allowed: ['review', 'backlog'] })

      const result = await phases.fetchAllowedPhases('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/allowed')
      expect(result).toEqual({ allowed: ['review', 'backlog'] })
    })

    it('[R4] returns { allowed }', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ allowed: ['review', 'backlog'] })

      const result = await phases.fetchAllowedPhases('t1')

      expect(result.allowed).toEqual(['review', 'backlog'])
    })
  })

  describe('fetchPhaseHistory', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      const history = [
        { to_phase: 'draft', actor_type: 'human', created_at: '2024-01-01T00:00:00Z' },
        { to_phase: 'in_progress', actor_type: 'human', created_at: '2024-01-02T00:00:00Z' },
      ]
      get.mockResolvedValue(history)

      const result = await phases.fetchPhaseHistory('ticket-1')

      expect(get).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases')
      expect(result).toEqual(history)
    })
  })

  describe('transitionPhase', () => {
    it('sends POST request with correct data', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ ticketId: 't1', fromPhase: 'draft', toPhase: 'review', status: 'backlog' })

      await phases.transitionPhase('ticket-1', 'review', {}, 'human')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'review',
        actorType: 'human',
        metadata: null,
      })
    })

    it('includes metadata when provided', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ ticketId: 't1', fromPhase: 'draft', toPhase: 'done', status: 'done' })

      await phases.transitionPhase('ticket-1', 'done', { reason: 'all tests pass' }, 'human')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'done',
        actorType: 'human',
        metadata: { reason: 'all tests pass' },
      })
    })

    it('defaults actorType to human', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ ticketId: 't1', fromPhase: 'draft', toPhase: 'review', status: 'backlog' })

      await phases.transitionPhase('ticket-1', 'review')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'review',
        actorType: 'human',
        metadata: null,
      })
    })

    it('uses provided actorType', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ ticketId: 't1', fromPhase: 'draft', toPhase: 'review', status: 'backlog' })

      await phases.transitionPhase('ticket-1', 'review', {}, 'agent')

      expect(post).toHaveBeenCalledWith('/api/v1/tickets/ticket-1/phases/transition', {
        toPhase: 'review',
        actorType: 'agent',
        metadata: null,
      })
    })

    it('[R4] transitionPhase returns PhaseTransitionResult', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ ticketId: 't1', fromPhase: 'a', toPhase: 'b', status: 'ok' })

      const result = await phases.transitionPhase('t1', 'b')

      expect(result.ticketId).toBe('t1')
      expect(result.fromPhase).toBe('a')
      expect(result.toPhase).toBe('b')
      expect(result.status).toBe('ok')
    })
  })
})
