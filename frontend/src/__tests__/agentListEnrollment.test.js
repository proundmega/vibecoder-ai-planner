import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const { authState } = vi.hoisted(() => ({
  authState: { read: true, create: true, revoke: true },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    hasAnyPermission: () => authState.read,
    canCreateAgent: () => authState.create,
    canRevokeAgent: () => authState.revoke,
  }),
}))

vi.mock('@/api/agents', () => ({
  fetchAgentStatusList: vi.fn().mockResolvedValue([]),
  createAgent: vi.fn(),
  listAgents: vi.fn().mockResolvedValue({ agents: [] }),
  updateAgentName: vi.fn(),
}))

vi.mock('@/api/providers', () => ({
  listProviders: vi.fn().mockResolvedValue([{ id: 4, name: 'OpenAI' }]),
}))

vi.mock('@/api/projects', () => ({
  fetchProjects: vi.fn().mockResolvedValue([{ id: 3, name: 'Project One' }]),
}))

vi.mock('@/api/agentEnrollment', () => ({
  listEnrollmentTokens: vi.fn(),
  mintEnrollmentToken: vi.fn(),
  revokeEnrollmentToken: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

import AgentList from '@/views/AgentList.vue'
import * as enrollmentApi from '@/api/agentEnrollment'

const mountOptions = {
  global: {
    stubs: { Teleport: { template: '<div><slot /></div>' } },
  },
}

async function openEnrollment(wrapper) {
  wrapper.vm.activeTab = 'enrollment'
  await flushPromises()
  await flushPromises()
}

describe('AgentList enrollment panel (FR16, NFR3)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.read = true
    authState.create = true
    authState.revoke = true
    localStorage.clear()
    enrollmentApi.listEnrollmentTokens.mockResolvedValue([
      {
        id: 5,
        project_id: 3,
        provider_id: null,
        name: 'join-a',
        max_uses: 1,
        used_count: 0,
        expires_at: '2027-01-01T00:00:00Z',
        revoked_at: null,
        created_at: '2026-11-18T00:00:00Z',
      },
    ])
  })

  it('lists join tokens for the selected project', async () => {
    const wrapper = mount(AgentList, mountOptions)
    await openEnrollment(wrapper)

    expect(enrollmentApi.listEnrollmentTokens).toHaveBeenCalledWith('3')
    expect(wrapper.text()).toContain('join-a')
    expect(wrapper.text()).toContain('0 / 1')
    expect(wrapper.text()).toContain('active')
  })

  it('shows a minted token once and keeps it out of localStorage', async () => {
    enrollmentApi.mintEnrollmentToken.mockResolvedValue({
      id: 6,
      name: 'node-1',
      token: 'enr_secret_once',
      max_uses: 1,
      used_count: 0,
      expires_at: '2027-01-01T00:00:00Z',
    })

    const wrapper = mount(AgentList, mountOptions)
    await openEnrollment(wrapper)

    await wrapper.find('.mint-form input[placeholder="Token name"]').setValue('node-1')
    await wrapper.find('.mint-form').trigger('submit')
    await flushPromises()

    expect(enrollmentApi.mintEnrollmentToken).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: '3', name: 'node-1', ttlSeconds: 900, maxUses: 1 })
    )
    expect(wrapper.text()).toContain('enr_secret_once')
    expect(wrapper.text()).toContain('Join token ID')
    expect(wrapper.text()).toContain('Token expires')
    expect(wrapper.text()).toContain('Join token')
    expect(wrapper.text()).not.toContain('API key')
    expect(JSON.stringify(localStorage)).not.toContain('enr_secret_once')
  })

  it('revokes a token when the user has permission', async () => {
    enrollmentApi.revokeEnrollmentToken.mockResolvedValue({ id: 5 })

    const wrapper = mount(AgentList, mountOptions)
    await openEnrollment(wrapper)

    const revoke = wrapper.findAll('button').find(button => button.text() === 'Revoke')
    expect(revoke).toBeTruthy()
    await revoke.trigger('click')
    await flushPromises()

    expect(enrollmentApi.revokeEnrollmentToken).toHaveBeenCalledWith(5)
  })

  it('hides mint and revoke actions without permissions', async () => {
    authState.create = false
    authState.revoke = false

    const wrapper = mount(AgentList, mountOptions)
    await openEnrollment(wrapper)

    expect(wrapper.find('.mint-form').exists()).toBe(false)
    expect(wrapper.findAll('button').some(button => button.text() === 'Revoke')).toBe(false)
  })

  it('hides the enrollment tab when the server disables the feature', async () => {
    enrollmentApi.listEnrollmentTokens.mockRejectedValue(
      Object.assign(new Error('Not found'), { status: 404 })
    )

    const wrapper = mount(AgentList, mountOptions)
    await openEnrollment(wrapper)

    expect(wrapper.findAll('button').some(button => button.text() === 'Enrollment')).toBe(false)
  })

  it('hides the panel content without AGENT_READ', async () => {
    authState.read = false

    const wrapper = mount(AgentList, mountOptions)
    await openEnrollment(wrapper)

    expect(wrapper.text()).toContain('do not have permission')
    expect(enrollmentApi.listEnrollmentTokens).not.toHaveBeenCalled()
  })
})
