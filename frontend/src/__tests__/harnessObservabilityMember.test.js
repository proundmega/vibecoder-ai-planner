import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const fixtures = vi.hoisted(() => ({
  dashboard: {
    projectId: 5,
    period: { since: '2026-11-01T00:00:00Z', until: '2026-11-17T00:00:00Z' },
    runs: {
      total: 0,
      succeeded: 0,
      failed: 0,
      deadLetter: 0,
      budgetExceeded: 0,
      running: 0,
      successRate: null,
      durationSeconds: { p50: null, p95: null },
    },
    recentRuns: [],
    throughput: [],
    cost: {
      models: [],
      totals: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, costUsd: 0, toolCalls: 0 },
    },
    stuckRuns: [],
    review: { reviewRounds: 0, fixRounds: 0 },
    toolCalls: { total: 0, failed: 0 },
    secretScan: { flaggedEvents: 0 },
    budget: {
      dailySpendUsd: 0,
      dailyLimitUsd: 10,
      killSwitch: null,
      routing: {
        policy: 'free_then_paid',
        freeModel: 'beam-free',
        paidModel: null,
        complexityThreshold: 3,
      },
      limits: {},
    },
    merge: null,
    rollback: null,
    alerts: [],
  },
  budgetPolicy: {
    projectId: 5,
    source: 'default',
    limits: {
      maxDurationSeconds: 2700,
      maxInputTokens: 1200000,
      maxOutputTokens: 300000,
      maxCostUsd: 5,
      maxToolCalls: 100,
      maxRetries: 2,
      warnRatio: 0.8,
    },
    quotas: {
      dailyCostUsd: 20,
      projectMaxConcurrentRuns: 4,
      agentMaxConcurrentRuns: 1,
    },
    routing: {
      policy: 'free_then_paid',
      freeModel: 'beam-free',
      paidModel: null,
      complexityThreshold: 3,
    },
    dailySpendUsd: 0,
    killSwitch: null,
  },
}))

vi.mock('@/api/harnessObservability', () => ({
  getHarnessDashboard: vi.fn().mockResolvedValue(fixtures.dashboard),
  getHarnessBudgetPolicy: vi.fn().mockResolvedValue(fixtures.budgetPolicy),
  getHarnessPrivacyPolicy: vi.fn().mockRejectedValue(new Error('403 Forbidden')),
  getHarnessAudit: vi.fn().mockResolvedValue([]),
  getHarnessKillSwitchAudit: vi.fn().mockResolvedValue([]),
  getHarnessTimeline: vi.fn().mockResolvedValue(null),
  updateHarnessBudgetPolicy: vi.fn(),
  updateHarnessKillSwitch: vi.fn(),
  updateHarnessPrivacyPolicy: vi.fn(),
  deleteHarnessProjectData: vi.fn(),
  exportHarnessProjectData: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    isSuperAdmin: () => false,
    isProjectAdmin: () => false,
  }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '5' } }),
}))

import HarnessObservability from '@/views/HarnessObservability.vue'

describe('HarnessObservability privacy gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('does not render the privacy panel or fail the page for a member', async () => {
    const wrapper = mount(HarnessObservability)
    await flushPromises()

    expect(wrapper.find('.error').exists()).toBe(false)
    expect(wrapper.text()).toContain('Harness Observability')
    expect(wrapper.text()).not.toContain('Privacy & data governance')
    expect(wrapper.text()).not.toContain('Save privacy policy')
    expect(wrapper.text()).not.toContain('Delete stored data')
  })
})
