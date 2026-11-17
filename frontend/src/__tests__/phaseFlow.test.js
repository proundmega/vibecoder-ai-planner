import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRoute, mockRouter } = vi.hoisted(() => ({
  mockRoute: { params: { id: 'p1', ticketId: 't1' } },
  mockRouter: { push: vi.fn() },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
  // Phase child components import api/client, which imports the app router.
  createRouter: vi.fn(() => ({
    beforeEach: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    currentRoute: { value: { fullPath: '/' } },
  })),
  createWebHistory: vi.fn(() => ({})),
}))

vi.mock('@/api/phases', () => ({
  fetchPhases: vi.fn(),
  fetchAllowedPhases: vi.fn(),
  fetchPhaseHistory: vi.fn(),
  transitionPhase: vi.fn(),
}))

import PhaseFlow from '@/views/PhaseFlow.vue'
import * as phasesApi from '@/api/phases'

describe('PhaseFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    phasesApi.fetchPhases.mockResolvedValue({ phase: 'draft' })
    phasesApi.fetchAllowedPhases.mockResolvedValue({ allowed: [] })
    phasesApi.fetchPhaseHistory.mockResolvedValue([
      { id: 'h1', to_phase: 'draft', actor_type: 'human', created_at: '2026-01-01T00:00:00Z' },
      { id: 'h2', to_phase: 'planning', actor_type: 'human', created_at: '2026-01-02T00:00:00Z' },
    ])
  })

  it('loads the phase history instead of throwing fetchPhaseHistory is not defined', async () => {
    const wrapper = mount(PhaseFlow)
    await flushPromises()

    expect(phasesApi.fetchPhaseHistory).toHaveBeenCalledWith('t1')
    expect(wrapper.find('.phase-history').exists()).toBe(true)
    expect(wrapper.text()).toContain('Phase History')
    expect(wrapper.find('.error-state').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('fetchPhaseHistory is not defined')
  })
})
