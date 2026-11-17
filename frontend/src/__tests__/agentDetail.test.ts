import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: 'a1' } }),
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    canRevokeAgent: () => true,
    canDeleteAgent: () => true,
  }),
}))

vi.mock('@/api/agents', () => ({
  fetchAgentDetail: vi.fn(),
  getAgentKeyInfo: vi.fn(),
  rotateAgentKey: vi.fn(),
  deleteAgent: vi.fn(),
  revokeAgentKey: vi.fn(),
}))

import AgentDetail from '@/views/AgentDetail.vue'
import * as agentsApi from '@/api/agents'

const mountOptions = {
  global: {
    stubs: { Teleport: { template: '<div><slot /></div>' } },
  },
}

describe('AgentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(agentsApi.fetchAgentDetail as ReturnType<typeof vi.fn>).mockResolvedValue({
      agent_id: 'a1',
      name: 'Worker One',
      status: 'online',
      totalActions: 3,
      totalCost: 0.5,
      current_step: 'idle',
      last_seen: '2026-11-17T10:00:00.000Z',
      history: [],
    })
    ;(agentsApi.getAgentKeyInfo as ReturnType<typeof vi.fn>).mockResolvedValue({
      name: 'Worker One',
      agentId: 'a1',
      providerId: 1,
      providerName: 'OpenAI',
      keyAvailable: false,
      expiresAt: '2026-12-17T00:00:00.000Z',
      rateLimit: 100,
      maxActionsPerDay: 1000,
      createdAt: '2026-11-17T00:00:00.000Z',
      enrolledAt: null,
    })
    ;(agentsApi.rotateAgentKey as ReturnType<typeof vi.fn>).mockResolvedValue({
      agentId: 'a1',
      agentName: 'Worker One',
      newApiKey: 'ak_rotated_secret',
      expiresAt: '2027-01-01T00:00:00.000Z',
      message: 'Key rotated',
    })
  })

  it('shows agent configuration and never a recoverable key', async () => {
    const wrapper = mount(AgentDetail, mountOptions)
    await flushPromises()

    const details = wrapper.find('.details-section')
    expect(details.exists()).toBe(true)
    expect(details.text()).toContain('Worker One')
    expect(details.text()).toContain('OpenAI')
    expect(details.text()).toContain('100 req/min')
    expect(details.text()).toContain('1000')
    expect(details.text()).toContain('Hidden — shown only at creation or rotation')
    expect(details.text()).toContain('2026')
  })

  it('rotates the key and shows the new key once', async () => {
    const wrapper = mount(AgentDetail, mountOptions)
    await flushPromises()

    const rotate = wrapper.findAll('button').find(button => button.text() === 'Rotate API Key')
    expect(rotate).toBeTruthy()
    await rotate!.trigger('click')
    await flushPromises()

    const confirm = wrapper.findAll('button').find(button => button.text() === 'Rotate key')
    expect(confirm).toBeTruthy()
    await confirm!.trigger('click')
    await flushPromises()

    expect(agentsApi.rotateAgentKey).toHaveBeenCalledWith('a1')
    expect(wrapper.find('.agent-key-value').text()).toBe('ak_rotated_secret')
    expect(wrapper.text()).toContain('New API key')
    expect(agentsApi.getAgentKeyInfo).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('agent_api_key')).toBeNull()
  })
})
