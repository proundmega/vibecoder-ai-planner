import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import AgentList from '@/views/AgentList.vue'
import * as agentNodesApi from '@/api/agentNodes'

const { authState } = vi.hoisted(() => ({
  authState: { read: true, create: true, revoke: true },
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { value: { id: 7 } },
    isSuperAdmin: () => false,
    hasAnyPermission: (permissions: string[]) => {
      if (permissions.includes('AGENT_READ')) return authState.read
      if (permissions.includes('AGENT_CREATE')) return authState.create
      if (permissions.includes('AGENT_REVOKE')) return authState.revoke
      return false
    },
  }),
}))

vi.mock('@/api/agentNodes', () => ({
  listAgentNodes: vi.fn(),
  getAgentNodeGrants: vi.fn(),
  createAgentGrant: vi.fn(),
  revokeAgentGrant: vi.fn(),
  drainAgentNode: vi.fn(),
  revokeAgentNode: vi.fn(),
  updateAgentRuntime: vi.fn(),
  mintAgentNodeToken: vi.fn(),
}))

vi.mock('@/api/projects', () => ({
  fetchProjectsStrict: vi.fn(),
}))

import * as projectsApi from '@/api/projects'

const mountOptions = {
  global: {
    stubs: {
      RouterLink: { template: '<a><slot /></a>' },
    },
  },
}

const node = {
  id: 1,
  owner_id: 7,
  owner_name: 'Ada Lovelace',
  name: 'build-host',
  hostname: 'box-1',
  fingerprint: 'fp-1',
  status: 'active' as const,
  last_seen_at: '2026-11-20T10:00:00.000Z',
  created_at: '2026-11-01T10:00:00.000Z',
  runtimes: [
    {
      id: 11,
      node_id: 1,
      name: 'worker-1',
      role: 'worker' as const,
      model_id: 3,
      credential_name: 'acme',
      model: 'gpt-4o',
      concurrency: 2,
      effort: 'high' as const,
      status: 'running' as const,
      current_project_id: null,
      last_seen_at: '2026-11-20T10:05:00.000Z',
      created_at: '2026-11-01T10:00:00.000Z',
      updated_at: '2026-11-20T10:05:00.000Z',
    },
  ],
  grants: [
    {
      id: 21,
      node_id: 1,
      project_id: 5,
      role: 'reviewer' as const,
      created_by: 7,
      revoked_at: null,
      created_at: '2026-11-02T10:00:00.000Z',
      project_name: 'Alpha',
    },
  ],
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(AgentList, mountOptions)
  await flushPromises()
  return wrapper
}

async function expandNode(wrapper: VueWrapper): Promise<void> {
  await wrapper.find('.node-summary').trigger('click')
  await flushPromises()
}

describe('Agent fleet view', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    authState.read = true
    authState.create = true
    authState.revoke = true
    ;(agentNodesApi.listAgentNodes as ReturnType<typeof vi.fn>).mockResolvedValue([node])
    ;(agentNodesApi.getAgentNodeGrants as ReturnType<typeof vi.fn>).mockResolvedValue(node.grants)
    ;(agentNodesApi.createAgentGrant as ReturnType<typeof vi.fn>).mockResolvedValue(node.grants[0])
    ;(agentNodesApi.revokeAgentGrant as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...node.grants[0],
      revoked_at: '2026-11-20T11:00:00.000Z',
    })
    ;(agentNodesApi.drainAgentNode as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...node,
      status: 'draining',
    })
    ;(agentNodesApi.revokeAgentNode as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...node,
      status: 'revoked',
    })
    ;(agentNodesApi.updateAgentRuntime as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...node.runtimes[0],
      status: 'draining',
    })
    ;(agentNodesApi.mintAgentNodeToken as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 99,
      name: 'new-host',
      token: 'enr_once_secret_token',
      expires_at: '2026-11-20T12:00:00.000Z',
      max_uses: 1,
    })
    ;(projectsApi.fetchProjectsStrict as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '5', name: 'Alpha' },
    ])
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('renders node status, owner and last seen (FR15)', async () => {
    wrapper = await mountView()

    expect(agentNodesApi.listAgentNodes).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('build-host')
    expect(text).toContain('active')
    expect(text).toContain('Ada Lovelace')
    expect(text).toContain('box-1')
    expect(text).toContain('2026')
  })

  it('expands a node and shows grants and runtimes with role tags and effort (FR15)', async () => {
    wrapper = await mountView()
    await expandNode(wrapper)

    expect(agentNodesApi.getAgentNodeGrants).toHaveBeenCalledWith(1)
    const text = wrapper.text()
    expect(text).toContain('Alpha')
    expect(text).toContain('acme/gpt-4o')
    expect(text).toContain('worker-1')
    expect(text).toContain('high')
    expect(text).toContain('running')

    const roleTags = wrapper.findAll('.role-tag').map(tag => tag.text())
    expect(roleTags).toContain('reviewer')
    expect(roleTags).toContain('worker')
  })

  it('drains and revokes a node through the contract endpoints', async () => {
    wrapper = await mountView()

    const drain = wrapper.findAll('button').find(button => button.text() === 'Drain')
    expect(drain).toBeTruthy()
    await drain!.trigger('click')
    await flushPromises()
    expect(agentNodesApi.drainAgentNode).toHaveBeenCalledWith(1)

    const revoke = wrapper.findAll('button').find(button => button.text() === 'Revoke')
    expect(revoke).toBeTruthy()
    await revoke!.trigger('click')
    await flushPromises()
    expect(agentNodesApi.revokeAgentNode).toHaveBeenCalledWith(1)
  })

  it('adds and revokes a project grant', async () => {
    wrapper = await mountView()
    await expandNode(wrapper)

    await wrapper.find('#grant-project-1').setValue('5')
    await wrapper.find('#grant-role-1').setValue('planner')
    const addGrant = wrapper.findAll('button').find(button => button.text() === 'Add grant')
    expect(addGrant).toBeTruthy()
    await addGrant!.trigger('click')
    await flushPromises()

    expect(agentNodesApi.createAgentGrant).toHaveBeenCalledWith(1, {
      projectId: '5',
      role: 'planner',
    })

    const revokeGrant = wrapper
      .findAll('button')
      .find(button => button.text() === 'Revoke grant')
    expect(revokeGrant).toBeTruthy()
    await revokeGrant!.trigger('click')
    await flushPromises()

    expect(agentNodesApi.revokeAgentGrant).toHaveBeenCalledWith(1, 21)
  })

  it('updates a runtime status over PATCH /agent-runtimes/:id', async () => {
    wrapper = await mountView()
    await expandNode(wrapper)

    const drainRuntime = wrapper
      .findAll('button')
      .find(button => button.text() === 'Drain runtime')
    expect(drainRuntime).toBeTruthy()
    await drainRuntime!.trigger('click')
    await flushPromises()

    expect(agentNodesApi.updateAgentRuntime).toHaveBeenCalledWith(11, { status: 'draining' })
  })

  it('hides mutation controls without AGENT_CREATE or AGENT_REVOKE', async () => {
    authState.create = false
    authState.revoke = false
    wrapper = await mountView()
    await expandNode(wrapper)

    const labels = wrapper.findAll('button').map(button => button.text())
    expect(labels).not.toContain('Drain')
    expect(labels).not.toContain('Revoke')
    expect(labels).not.toContain('Add grant')
    expect(labels).not.toContain('Revoke grant')
    expect(labels).not.toContain('Drain runtime')
    expect(wrapper.text()).toContain('build-host')
  })

  it('does not load or render the fleet without AGENT_READ', async () => {
    authState.read = false
    wrapper = await mountView()

    expect(agentNodesApi.listAgentNodes).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('do not have permission')
  })

  it('mints a node join token and shows it once', async () => {
    wrapper = await mountView()

    const mint = wrapper.findAll('button').find(button => button.text() === 'Mint join token')
    expect(mint).toBeTruthy()
    await mint!.trigger('click')
    await flushPromises()

    await wrapper.find('#mint-node-name').setValue('new-host')
    const submit = wrapper.findAll('button').find(button => button.text() === 'Mint')
    expect(submit).toBeTruthy()
    await submit!.trigger('click')
    await flushPromises()

    expect(agentNodesApi.mintAgentNodeToken).toHaveBeenCalledWith({
      name: 'new-host',
      ttl_seconds: 900,
      max_uses: 1,
    })
    expect(wrapper.text()).toContain('enr_once_secret_token')
  })

  it('never renders static agent key material', async () => {
    wrapper = await mountView()
    await expandNode(wrapper)

    const text = wrapper.text()
    expect(text.toLowerCase()).not.toContain('api key')
    expect(text).not.toMatch(/agent[_-]?api[_-]?key/i)
  })
})
