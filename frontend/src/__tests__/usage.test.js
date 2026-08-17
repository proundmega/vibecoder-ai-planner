import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as usage from '../api/usage'

vi.mock('../api/client', () => ({
  get: vi.fn(),
}))

describe('usage API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getProjectUsage', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ breakdown: [], totals: {} })

      const result = await usage.getProjectUsage('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/usage/projects/proj-123/usage')
      expect(result).toEqual({ breakdown: [], totals: {} })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await usage.getProjectUsage('proj-123')

      expect(result).toBeNull()
    })

    it('[R1] breakdown rows use total_in/total_out/total_cost/total_calls', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({
        breakdown: [{ model: 'gpt-4', total_in: 100, total_out: 50, total_cost: 0.01, total_calls: 2 }],
        totals: {},
      })

      const result = await usage.getProjectUsage('p1')

      expect(result.breakdown[0].total_in).toBe(100)
      expect(result.breakdown[0].total_out).toBe(50)
      expect(result.breakdown[0].total_cost).toBe(0.01)
      expect(result.breakdown[0].total_calls).toBe(2)
    })
  })

  describe('getUserUsage', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ totalCost: 5.5 })

      const result = await usage.getUserUsage()

      expect(get).toHaveBeenCalledWith('/api/v1/usage/users/me/usage')
      expect(result).toEqual({ totalCost: 5.5 })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await usage.getUserUsage()

      expect(result).toBeNull()
    })
  })

  describe('getModelPricing', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ models: [{ model: 'gpt-4', pricing: { input_cost_per_million: 0.03, output_cost_per_million: 0.06 } }] })

      const result = await usage.getModelPricing()

      expect(get).toHaveBeenCalledWith('/api/v1/usage/pricing/models')
      expect(result).toEqual({ models: [{ model: 'gpt-4', pricing: { input_cost_per_million: 0.03, output_cost_per_million: 0.06 } }] })
    })

    it('returns empty models array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await usage.getModelPricing()

      expect(result).toEqual({ models: [] })
    })
  })
})
