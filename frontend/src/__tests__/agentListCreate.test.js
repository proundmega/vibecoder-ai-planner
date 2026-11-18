import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('@/api/agents', () => ({
  fetchAgentStatusList: vi.fn(),
  createAgent: vi.fn(),
  listAgents: vi.fn(),
  updateAgentName: vi.fn(),
}))

vi.mock('@/api/providers', () => ({
  listProviders: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hasAnyPermission: () => true,
    canCreateAgent: () => true,
    canRevokeAgent: () => true,
  }),
}))

vi.mock('@/api/projects', () => ({
  fetchProjects: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/api/agentEnrollment', () => ({
  listEnrollmentTokens: vi.fn().mockResolvedValue([]),
  mintEnrollmentToken: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import AgentList from '@/views/AgentList.vue'
import * as agentsApi from '@/api/agents'
import * as providersApi from '@/api/providers'

const mountOptions = {
  global: {
    stubs: { Teleport: { template: '<div><slot /></div>' } },
  },
}

async function openCreateModal(wrapper) {
  const button = wrapper.findAll('button').find(b => b.text() === 'Create Agent')
  expect(button).toBeTruthy()
  await button.trigger('click')
  await flushPromises()
}

describe('AgentList create flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    providersApi.listProviders.mockResolvedValue([])
    agentsApi.fetchAgentStatusList.mockResolvedValue([])
    agentsApi.listAgents.mockResolvedValue({ agents: [] })
  })

  it('refreshes the tables and keeps the form reusable after creating', async () => {
    agentsApi.fetchAgentStatusList
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { agent_id: 'a1', name: 'New Agent', status: 'online', actions_today: 0, cost_today: 0 },
      ])
    agentsApi.listAgents
      .mockResolvedValueOnce({ agents: [] })
      .mockResolvedValue({
        agents: [{ id: 'a1', name: 'New Agent', provider_name: null, rate_limit: 100, created_at: null }],
      })
    agentsApi.createAgent.mockResolvedValue({
      id: 'a1',
      name: 'New Agent',
      provider_id: null,
      generatedApiKey: 'ak_test_secret',
      api_key_expires_at: '2026-12-17T00:00:00.000Z',
    })

    const wrapper = mount(AgentList, mountOptions)
    await flushPromises()

    const agentsTab = wrapper.findAll('button').find(b => b.text() === 'Agents')
    await agentsTab.trigger('click')
    await flushPromises()
    expect(agentsApi.listAgents).toHaveBeenCalledTimes(1)

    await openCreateModal(wrapper)
    await wrapper.find('.v-modal input').setValue('New Agent')
    await wrapper.find('.v-modal form').trigger('submit')
    await flushPromises()

    expect(agentsApi.createAgent).toHaveBeenCalledWith({
      name: 'New Agent',
      providerId: null,
      rateLimit: 100,
      maxActionsPerDay: 1000,
      keyExpiryDays: 30,
    })
    // Both the heartbeat table and the CRUD table refresh immediately.
    expect(agentsApi.fetchAgentStatusList).toHaveBeenCalledTimes(2)
    expect(agentsApi.listAgents).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('New Agent')

    // The one-time key is shown in the success dialog, not stored client-side.
    const reveal = wrapper.find('.agent-key-reveal')
    expect(reveal.exists()).toBe(true)
    expect(reveal.text()).toContain('ak_test_secret')
    expect(reveal.text()).toContain('Agent ID')
    expect(localStorage.getItem('agent_api_key')).toBeNull()

    const done = reveal.findAll('button').find(button => button.text() === 'Done')
    await done.trigger('click')
    await flushPromises()
    expect(wrapper.find('.agent-key-reveal').exists()).toBe(false)

    // Reopening must not be stuck on "Creating..."
    await openCreateModal(wrapper)
    const submit = wrapper.find('button[type="submit"]')
    expect(submit.text()).toBe('Create')
    expect(wrapper.find('.v-modal input').element.value).toBe('')

    wrapper.unmount()
  })

  it('keeps the modal open and resets the creating state on failure', async () => {
    agentsApi.createAgent.mockRejectedValue(new Error('boom'))

    const wrapper = mount(AgentList, mountOptions)
    await flushPromises()

    await openCreateModal(wrapper)
    await wrapper.find('.v-modal input').setValue('New Agent')
    await wrapper.find('.v-modal form').trigger('submit')
    await flushPromises()

    expect(wrapper.find('.v-modal__title').exists()).toBe(true)
    expect(wrapper.find('.v-modal .submit-error').text()).toContain('boom')
    expect(wrapper.text()).toContain('boom')
    const submit = wrapper.find('button[type="submit"]')
    expect(submit.text()).toBe('Create')
    expect(submit.attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('re-enables the modal when create hangs past the timeout', async () => {
    vi.useFakeTimers()
    try {
      agentsApi.createAgent.mockReturnValue(new Promise(() => {}))

      const wrapper = mount(AgentList, mountOptions)
      await wrapper.vm.$nextTick()

      const button = wrapper.findAll('button').find(b => b.text() === 'Create Agent')
      await button.trigger('click')
      await wrapper.vm.$nextTick()
      await wrapper.find('.v-modal input').setValue('Hanging Agent')
      await wrapper.find('.v-modal form').trigger('submit')
      await wrapper.vm.$nextTick()

      expect(wrapper.find('button[type="submit"]').text()).toBe('Creating...')

      await vi.advanceTimersByTimeAsync(30000)
      await wrapper.vm.$nextTick()

      const submit = wrapper.find('button[type="submit"]')
      expect(submit.text()).toBe('Create')
      expect(wrapper.find('.v-modal .submit-error').text()).toContain('taking longer than expected')

      // Once the timeout releases `creating`, the overlay can close the dialog.
      await wrapper.find('.v-modal-overlay').trigger('click')
      await wrapper.vm.$nextTick()
      expect(wrapper.find('.v-modal input').exists()).toBe(false)

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
