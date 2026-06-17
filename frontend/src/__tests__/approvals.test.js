import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as approvals from '../api/approvals'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
}))

describe('approvals API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('createApproval', () => {
    it('sends POST with ticketId', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'a1', ticketId: 't1', status: 'pending' })

      const result = await approvals.createApproval('t1')

      expect(post).toHaveBeenCalledWith('/api/v1/approvals', { ticketId: 't1' })
      expect(result).toEqual({ id: 'a1', ticketId: 't1', status: 'pending' })
    })
  })

  describe('getPendingApprovals', () => {
    it('sends GET to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'a1', ticketId: 't1', status: 'pending' }])

      const result = await approvals.getPendingApprovals()

      expect(get).toHaveBeenCalledWith('/api/v1/approvals/pending')
      expect(result).toEqual([{ id: 'a1', ticketId: 't1', status: 'pending' }])
    })
  })

  describe('getTicketApprovals', () => {
    it('sends GET with ticketId in URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'a1', ticketId: 't1' }])

      const result = await approvals.getTicketApprovals('t1')

      expect(get).toHaveBeenCalledWith('/api/v1/approvals/ticket/t1')
      expect(result).toEqual([{ id: 'a1', ticketId: 't1' }])
    })
  })

  describe('approveRequest', () => {
    it('sends POST to correct URL', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'a1', status: 'approved' })

      const result = await approvals.approveRequest('a1')

      expect(post).toHaveBeenCalledWith('/api/v1/approvals/a1/approve')
      expect(result).toEqual({ id: 'a1', status: 'approved' })
    })
  })

  describe('rejectRequest', () => {
    it('sends POST to correct URL', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'a1', status: 'rejected' })

      const result = await approvals.rejectRequest('a1')

      expect(post).toHaveBeenCalledWith('/api/v1/approvals/a1/reject')
      expect(result).toEqual({ id: 'a1', status: 'rejected' })
    })
  })
})
