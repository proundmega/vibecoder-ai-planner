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
      get.mockResolvedValue([{ total_cost: 12.5 }])

      const result = await billing.getProjectBilling('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/billing/projects/proj-123/billing')
      expect(Array.isArray(result)).toBe(true)
      expect(result).toEqual([{ total_cost: 12.5 }])
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await billing.getProjectBilling('proj-123')

      expect(result).toBeNull()
    })

    it('[R2] returns an array (not a single object)', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ provider_type: 'openai', model: 'gpt-4', total_cost: 1.5 }])

      const result = await billing.getProjectBilling('p1')

      expect(Array.isArray(result)).toBe(true)
      expect(result[0].total_cost).toBe(1.5)
    })
  })

  describe('getUserBilling', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ total: 25.0 }])

      const result = await billing.getUserBilling()

      expect(get).toHaveBeenCalledWith('/api/v1/billing/users/me/billing')
      expect(Array.isArray(result)).toBe(true)
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await billing.getUserBilling()

      expect(result).toBeNull()
    })
  })
})
