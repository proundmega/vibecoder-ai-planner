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
      get.mockResolvedValue({ totalCost: 0, totalTokens: 0 })

      const result = await usage.getProjectUsage('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/usage/projects/proj-123/usage')
      expect(result).toEqual({ totalCost: 0, totalTokens: 0 })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await usage.getProjectUsage('proj-123')

      expect(result).toBeNull()
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
