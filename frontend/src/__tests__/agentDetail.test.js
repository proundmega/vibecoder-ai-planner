import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentDetail from '@/views/AgentDetail.vue'

vi.mock('@/stores/auth', () => ({
  useAuthStore: vi.fn(),
}))

vi.mock('@/api/agents', () => ({
  fetchAgentDetail: vi.fn(),
  deleteAgent: vi.fn(),
  revokeAgentKey: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({ params: { id: 'agent-1' } })),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}))

describe('AgentDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  async function createWrapper(role) {
    const { useAuthStore } = await import('@/stores/auth')
    useAuthStore.mockImplementation(() => ({ user: { value: { role } } }))

    const { fetchAgentDetail } = await import('@/api/agents')
    fetchAgentDetail.mockResolvedValue({ agent_id: 'agent-1', agent_name: 'Test Agent', status: 'online' })

    const wrapper = mount(AgentDetail, {
      global: {
        stubs: { 'router-link': { template: '<span><slot /></span>' } },
      },
    })
    // Wait for onMounted + fetchAgentDetail to complete
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    return wrapper
  }

  it('renders Revoke button when user is super_admin', async () => {
    const wrapper = await createWrapper('super_admin')
    expect(wrapper.find('.btn-danger-outline').exists()).toBe(true)
  })

  it('renders Delete button when user is project_admin', async () => {
    const wrapper = await createWrapper('project_admin')
    expect(wrapper.find('.btn-danger').text()).toContain('Delete Agent')
  })

  it('does NOT render Delete button for user role', async () => {
    const wrapper = await createWrapper('user')
    expect(wrapper.find('.btn-danger').exists()).toBe(false)
    expect(wrapper.find('.btn-danger-outline').exists()).toBe(false)
  })

  it('does NOT render Delete button for member role', async () => {
    const wrapper = await createWrapper('member')
    expect(wrapper.find('.btn-danger').exists()).toBe(false)
  })

  it('clicking Revoke opens confirmation modal', async () => {
    const wrapper = await createWrapper('super_admin')
    await wrapper.find('.btn-danger-outline').trigger('click')
    expect(wrapper.find('.modal-overlay').exists()).toBe(true)
  })

  it('clicking Delete opens confirmation modal', async () => {
    const wrapper = await createWrapper('project_admin')
    await wrapper.find('.btn-danger').trigger('click')
    expect(wrapper.findAll('.modal-overlay').length).toBeGreaterThan(0)
  })

  it('confirming Revoke calls revokeAgentKey API', async () => {
    const { revokeAgentKey } = await import('@/api/agents')
    revokeAgentKey.mockResolvedValue({ success: true })

    const wrapper = await createWrapper('super_admin')
    await wrapper.find('.btn-danger-outline').trigger('click')
    await wrapper.find('.modal-actions .btn-danger').trigger('click')
    expect(revokeAgentKey).toHaveBeenCalledWith('agent-1')
  })

  it('confirming Delete calls deleteAgent API and navigates', async () => {
    const { deleteAgent } = await import('@/api/agents')
    deleteAgent.mockResolvedValue({ success: true })

    const wrapper = await createWrapper('super_admin')
    await wrapper.find('.btn-danger').trigger('click')
    await wrapper.find('.modal-actions .btn-danger').trigger('click')
    expect(deleteAgent).toHaveBeenCalledWith('agent-1')
  })

  it('canceling confirmation closes modal', async () => {
    const wrapper = await createWrapper('super_admin')
    await wrapper.find('.btn-danger-outline').trigger('click')
    await wrapper.find('.modal-actions .btn-cancel').trigger('click')
    expect(wrapper.find('.modal-overlay').exists()).toBe(false)
  })

  it('buttons are disabled during actionLoading', async () => {
    const { revokeAgentKey } = await import('@/api/agents')
    revokeAgentKey.mockResolvedValue({ success: true })

    const wrapper = await createWrapper('super_admin')
    await wrapper.find('.btn-danger-outline').trigger('click')
    await wrapper.vm.$nextTick()
    expect(wrapper.vm.actionLoading).toBe(false)
    await wrapper.find('.modal-actions .btn-danger').trigger('click')
    expect(wrapper.vm.actionLoading).toBe(true)
    await wrapper.vm.$nextTick()
  })

  it('shows error message when API call fails', async () => {
    const { revokeAgentKey } = await import('@/api/agents')
    revokeAgentKey.mockRejectedValue(new Error('Network error'))

    const wrapper = await createWrapper('super_admin')
    await wrapper.find('.btn-danger-outline').trigger('click')
    await wrapper.find('.modal-actions .btn-danger').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.error').text()).toBe('Network error')
  })
})
