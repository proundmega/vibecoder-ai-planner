import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import AgentList from '@/views/AgentList.vue'
import * as agentsApi from '@/api/agents'

vi.mock('@/api/agents', () => ({
  fetchAgentStatusList: vi.fn(),
  createAgent: vi.fn(),
  listAgents: vi.fn(),
  updateAgentName: vi.fn(),
  deleteAgent: vi.fn(),
  revokeAgentKey: vi.fn(),
  getAgentKeyInfo: vi.fn(),
  getAgentHistory: vi.fn(),
  fetchAgentDetail: vi.fn(),
  getAgentProviderConfig: vi.fn(),
}))

vi.mock('@/api/providers', () => ({
  listProviders: vi.fn().mockResolvedValue([]),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { path: '/' } } }),
  useRoute: () => ({ params: {} }),
}))

describe('AgentList inline edit', () => {
  let wrapper: VueWrapper

  const mockAgents = [
    { id: 'a1', name: 'Agent Alpha', provider_name: 'claude', rate_limit: 100, created_at: '2026-01-15' },
    { id: 'a2', name: 'Agent Beta', provider_name: 'openai', rate_limit: 200, created_at: '2026-02-20' },
  ]

  beforeEach(async () => {
    vi.clearAllMocks()
    ;(agentsApi.listAgents as ReturnType<typeof vi.fn>).mockResolvedValue({ agents: mockAgents })
    wrapper = mount(AgentList)
    // Switch to Agents tab and wait for data to load
    ;(wrapper.vm as unknown as { activeTab: string }).activeTab = 'agents'
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 100))
  })

  afterAll(() => {
    wrapper.unmount()
  })

  it('shows edit button next to each agent name', () => {
    const editButtons = wrapper.findAll('.btn-edit')
    expect(editButtons).toHaveLength(2)
    expect(editButtons[0].text()).toBe('Edit')
  })

  it('clicking edit shows input field with current name', async () => {
    const editButtons = wrapper.findAll('.btn-edit')
    await editButtons[0].trigger('click')
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 50))
    const input = wrapper.find('.edit-input')
    expect(input.exists()).toBe(true)
    expect((input.element as HTMLInputElement).value).toBe('Agent Alpha')
  })

  it('saving calls updateAgentName API', async () => {
    ;(agentsApi.updateAgentName as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Agent Alpha Updated' })
    const editButtons = wrapper.findAll('.btn-edit')
    await editButtons[0].trigger('click')
    await wrapper.vm.$nextTick()
    const input = wrapper.find('.edit-input')
    input.setValue('Agent Alpha Updated')
    await input.trigger('blur')
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 50))
    expect(agentsApi.updateAgentName).toHaveBeenCalledWith('a1', 'Agent Alpha Updated')
  })

  it('canceling discards changes', async () => {
    const editButtons = wrapper.findAll('.btn-edit')
    await editButtons[0].trigger('click')
    await wrapper.vm.$nextTick()
    const cancelButton = wrapper.find('.btn-sm')
    await cancelButton.trigger('click')
    await wrapper.vm.$nextTick()
    await new Promise(r => setTimeout(r, 50))
    const input = wrapper.find('.edit-input')
    expect(input.exists()).toBe(false)
  })
})
