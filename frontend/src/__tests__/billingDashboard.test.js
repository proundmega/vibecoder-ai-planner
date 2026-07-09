import { describe, it, expect, beforeEach } from 'vitest'
import { computed, ref } from 'vue'

const defaultBillingData = [
  { project_id: 'p1', project_name: 'Project A', billing_month: '2024-01', total_calls: 100, total_tokens_in: 5000, total_tokens_out: 3000, total_cost_usd: '12.50' },
  { project_id: 'p2', project_name: 'Project B', billing_month: '2024-01', total_calls: 200, total_tokens_in: 8000, total_tokens_out: 6000, total_cost_usd: '25.75' },
  { project_id: 'p1', project_name: 'Project A', billing_month: '2024-02', total_calls: 150, total_tokens_in: 6000, total_tokens_out: 4000, total_cost_usd: '18.25' },
]

describe('BillingDashboard computed totals', () => {
  let billingData
  let totalCost
  let totalCalls
  let totalTokensIn
  let totalTokensOut
  let billingPeriods
  let projects

  beforeEach(() => {
    billingData = ref(JSON.parse(JSON.stringify(defaultBillingData)))
    totalCost = computed(() => {
      return billingData.value.reduce((sum, b) => sum + (parseFloat(b.total_cost_usd) || 0), 0).toFixed(4)
    })
    totalCalls = computed(() => {
      return billingData.value.reduce((sum, b) => sum + (parseInt(b.total_calls) || 0), 0).toLocaleString()
    })
    totalTokensIn = computed(() => {
      return billingData.value.reduce((sum, b) => sum + (parseInt(b.total_tokens_in) || 0), 0).toLocaleString()
    })
    totalTokensOut = computed(() => {
      return billingData.value.reduce((sum, b) => sum + (parseInt(b.total_tokens_out) || 0), 0).toLocaleString()
    })
    billingPeriods = computed(() => {
      return new Set(billingData.value.map(b => b.billing_month)).size
    })
    projects = computed(() => {
      return new Set(billingData.value.map(b => b.project_id)).size
    })
  })

  describe('totalCost', () => {
    it('sums all total_cost_usd values', () => {
      expect(totalCost.value).toBe('56.5000')
    })

    it('handles empty billing data', () => {
      billingData.value = []
      expect(totalCost.value).toBe('0.0000')
    })

    it('handles null/undefined cost values', () => {
      billingData.value = [
        { total_cost_usd: null },
        { total_cost_usd: undefined },
        { total_cost_usd: '10.50' },
      ]
      expect(totalCost.value).toBe('10.5000')
    })

    it('handles non-numeric cost values', () => {
      billingData.value = [
        { total_cost_usd: 'invalid' },
        { total_cost_usd: '5.00' },
      ]
      expect(totalCost.value).toBe('5.0000')
    })
  })

  describe('totalCalls', () => {
    it('sums all total_calls values', () => {
      expect(totalCalls.value).toBe('450')
    })

    it('handles empty billing data', () => {
      billingData.value = []
      expect(totalCalls.value).toBe('0')
    })

    it('handles null/undefined call values', () => {
      billingData.value = [
        { total_calls: null },
        { total_calls: undefined },
        { total_calls: 50 },
      ]
      expect(totalCalls.value).toBe('50')
    })

    it('formats large numbers with locale separators', () => {
      billingData.value = [
        { total_calls: 1000 },
        { total_calls: 2000 },
      ]
      expect(totalCalls.value).toBe('3,000')
    })
  })

  describe('totalTokensIn', () => {
    it('sums all total_tokens_in values', () => {
      expect(totalTokensIn.value).toBe('19,000')
    })

    it('handles empty billing data', () => {
      billingData.value = []
      expect(totalTokensIn.value).toBe('0')
    })
  })

  describe('totalTokensOut', () => {
    it('sums all total_tokens_out values', () => {
      expect(totalTokensOut.value).toBe('13,000')
    })

    it('handles empty billing data', () => {
      billingData.value = []
      expect(totalTokensOut.value).toBe('0')
    })
  })

  describe('billingPeriods', () => {
    it('counts unique billing months', () => {
      expect(billingPeriods.value).toBe(2)
    })

    it('returns 0 for empty billing data', () => {
      billingData.value = []
      expect(billingPeriods.value).toBe(0)
    })

    it('counts all unique when all months differ', () => {
      billingData.value = [
        { billing_month: '2024-01' },
        { billing_month: '2024-02' },
        { billing_month: '2024-03' },
      ]
      expect(billingPeriods.value).toBe(3)
    })
  })

  describe('projects', () => {
    it('counts unique project IDs', () => {
      expect(projects.value).toBe(2)
    })

    it('returns 0 for empty billing data', () => {
      billingData.value = []
      expect(projects.value).toBe(0)
    })

    it('counts all unique when all projects differ', () => {
      billingData.value = [
        { project_id: 'p1' },
        { project_id: 'p2' },
        { project_id: 'p3' },
      ]
      expect(projects.value).toBe(3)
    })
  })

  describe('computed properties update reactively', () => {
    it('updates totalCost when billing data changes', () => {
      expect(totalCost.value).toBe('56.5000')
      billingData.value.push({ project_id: 'p3', billing_month: '2024-03', total_cost_usd: '10.00' })
      expect(totalCost.value).toBe('66.5000')
    })

    it('updates billingPeriods when billing data changes', () => {
      expect(billingPeriods.value).toBe(2)
      billingData.value.push({ project_id: 'p3', billing_month: '2024-03', total_cost_usd: '10.00' })
      expect(billingPeriods.value).toBe(3)
    })
  })
})
