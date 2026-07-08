import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as billing from '../api/billing'

vi.mock('../api/client', () => ({
  get: vi.fn(),
}))

describe('billing API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getProjectBilling', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ total: 12.5 })

      const result = await billing.getProjectBilling('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/billing/projects/proj-123/billing')
      expect(result).toEqual({ total: 12.5 })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await billing.getProjectBilling('proj-123')

      expect(result).toBeNull()
    })
  })

  describe('getUserBilling', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ total: 25.0 })

      const result = await billing.getUserBilling()

      expect(get).toHaveBeenCalledWith('/api/v1/billing/users/me/billing')
      expect(result).toEqual({ total: 25.0 })
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await billing.getUserBilling()

      expect(result).toEqual([])
    })
  })
})
