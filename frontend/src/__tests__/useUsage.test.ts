import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useUsage } from '@/composables/useUsage'

const mockGetProjectUsage = vi.fn()
const mockGetProjectBilling = vi.fn()

vi.mock('@/api/usage', () => ({
  getProjectUsage: (...args: unknown[]) => mockGetProjectUsage(...args),
}))

vi.mock('@/api/billing', () => ({
  getProjectBilling: (...args: unknown[]) => mockGetProjectBilling(...args),
}))

describe('useUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('initializes with default values', () => {
    const usage = useUsage(1)
    expect(usage.usage.value).toBeNull()
    expect(usage.usageLoading.value).toBe(false)
    expect(usage.usageError.value).toBeNull()
    expect(usage.billing.value).toEqual([])
    expect(usage.billingLoading.value).toBe(false)
    expect(usage.billingError.value).toBeNull()
  })

  it('loadUsage sets usage data', async () => {
    const usage = useUsage(1)
    const mockUsage = {
      totals: { totalCalls: 100, totalCost: 0.5, totalTokensIn: 5000, totalTokensOut: 3000 },
      breakdown: [],
    }
    mockGetProjectUsage.mockResolvedValue(mockUsage)

    await usage.loadUsage()
    expect(usage.usageLoading.value).toBe(false)
    expect(usage.usage.value).toEqual(mockUsage)
    expect(usage.usageError.value).toBeNull()
  })

  it('loadUsage sets error on failure', async () => {
    const usage = useUsage(1)
    mockGetProjectUsage.mockRejectedValue(new Error('fail'))

    await usage.loadUsage()
    expect(usage.usageLoading.value).toBe(false)
    expect(usage.usageError.value).toBe('Failed to load usage data')
  })

  it('loadBilling sets billing data', async () => {
    const usage = useUsage(1)
    const mockBilling = {
      project_id: '1',
      total_cost: 0.25,
      total_calls: 50,
      total_in: 1000,
      total_out: 500,
    }
    mockGetProjectBilling.mockResolvedValue([mockBilling])

    await usage.loadBilling()
    expect(usage.billingLoading.value).toBe(false)
    expect(usage.billing.value).toEqual([mockBilling])
    expect(usage.billingError.value).toBeNull()
  })

  it('loadBilling sets error on failure', async () => {
    const usage = useUsage(1)
    mockGetProjectBilling.mockRejectedValue(new Error('fail'))

    await usage.loadBilling()
    expect(usage.billingLoading.value).toBe(false)
    expect(usage.billingError.value).toBe('Failed to load billing data')
  })

  it('[R2] loadBilling stores a flat array (no nested [result])', async () => {
    const usage = useUsage(1)
    mockGetProjectBilling.mockResolvedValue([{ provider_type: 'openai', model: 'gpt-4', total_cost: 1.5 }])

    await usage.loadBilling()

    expect(usage.billing.value).toEqual([{ provider_type: 'openai', model: 'gpt-4', total_cost: 1.5 }])
  })

  it('[R2] loadBilling sets [] when result is null', async () => {
    const usage = useUsage(1)
    mockGetProjectBilling.mockResolvedValue(null)

    await usage.loadBilling()

    expect(usage.billing.value).toEqual([])
  })
})
