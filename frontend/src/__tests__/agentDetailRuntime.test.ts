import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'

const { authState } = vi.hoisted(() => ({
  authState: { create: true, revoke: true, id: 'r1', userId: 4 },
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: authState.id } }),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { value: { id: authState.userId } },
    isSuperAdmin: () => false,
    hasAnyPermission: (permissions: string[]) => {
      if (permissions.includes('AGENT_CREATE')) return authState.create
      if (permissions.includes('AGENT_REVOKE')) return authState.revoke
      return false
    },
  }),
}))

vi.mock('@/api/agentNodes', () => ({
  listAgentNodes: vi.fn(),
  getAgentNodeGrants: vi.fn(),
  drainAgentNode: vi.fn(),
  revokeAgentNode: vi.fn(),
  updateAgentRuntime: vi.fn(),
}))

import AgentDetail from '@/views/AgentDetail.vue'
import * as agentNodesApi from '@/api/agentNodes'

const mountOptions = {
  global: {
    stubs: {
      RouterLink: { template: '<a><slot /></a>' },
    },
  },
}

const runtime = {
  id: 'r1',
  node_id: 2,
  name: 'reviewer-2',
  role: 'reviewer' as const,
  model_id: 8,
  model_ref: 'acme/claude-opus',
  concurrency: 1,
  effort: 'max' as const,
  status: 'running' as const,
  current_project_id: null,
  last_seen_at: '2026-11-20T10:00:00.000Z',
  created_at: '2026-11-01T10:00:00.000Z',
  updated_at: '2026-11-20T10:00:00.000Z',
}

const node = {
  id: 2,
  owner_id: 4,
  owner_name: 'Grace Hopper',
  name: 'review-host',
  hostname: 'box-2',
  fingerprint: 'fp-2',
  status: 'active' as const,
  last_seen_at: '2026-11-20T10:00:00.000Z',
  created_at: '2026-11-01T10:00:00.000Z',
  runtimes: [runtime],
  grants: [],
}

async function mountView(): Promise<VueWrapper> {
  const wrapper = mount(AgentDetail, mountOptions)
  await flushPromises()
  return wrapper
}

describe('Agent runtime detail view', () => {
  let wrapper: VueWrapper | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    authState.create = true
    authState.revoke = true
    authState.id = 'r1'
    ;(agentNodesApi.listAgentNodes as ReturnType<typeof vi.fn>).mockResolvedValue([node])
    ;(agentNodesApi.getAgentNodeGrants as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(agentNodesApi.updateAgentRuntime as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...runtime,
      status: 'draining',
    })
    ;(agentNodesApi.drainAgentNode as ReturnType<typeof vi.fn>).mockResolvedValue(node)
    ;(agentNodesApi.revokeAgentNode as ReturnType<typeof vi.fn>).mockResolvedValue(node)
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = undefined
  })

  it('resolves the runtime and shows role, model, effort, status and node', async () => {
    wrapper = await mountView()

    expect(agentNodesApi.listAgentNodes).toHaveBeenCalled()
    const text = wrapper.text()
    expect(text).toContain('reviewer-2')
    expect(text).toContain('reviewer')
    expect(text).toContain('acme/claude-opus')
    expect(text).toContain('max')
    expect(text).toContain('running')
    expect(text).toContain('review-host')
  })

  it('updates the runtime status with PATCH /agent-runtimes/:id', async () => {
    wrapper = await mountView()

    const drain = wrapper.findAll('button').find(button => button.text() === 'Drain runtime')
    expect(drain).toBeTruthy()
    await drain!.trigger('click')
    await flushPromises()

    expect(agentNodesApi.updateAgentRuntime).toHaveBeenCalledWith('r1', { status: 'draining' })
  })

  it('falls back to the node record when the id is a node', async () => {
    authState.id = '2'
    wrapper = await mountView()

    const text = wrapper.text()
    expect(text).toContain('review-host')
    expect(text).toContain('Grace Hopper')
    expect(text).toContain('Drain node')
  })

  it('shows the unresolved runtime record with a link back to the fleet', async () => {
    authState.id = 'missing'
    wrapper = await mountView()

    const text = wrapper.text()
    expect(text).toContain('Runtime record')
    expect(text).toContain('missing')
    expect(text).toContain('Unknown')
    expect(text).toContain('Back to fleet')
  })

  it('hides runtime and node actions without mutation permissions', async () => {
    authState.create = false
    authState.revoke = false
    wrapper = await mountView()

    const labels = wrapper.findAll('button').map(button => button.text())
    expect(labels).not.toContain('Drain runtime')
    expect(labels).not.toContain('Stop runtime')
    expect(labels).not.toContain('Start runtime')
  })

  it('does not expose a static agent key', async () => {
    wrapper = await mountView()

    expect(wrapper.text().toLowerCase()).not.toContain('api key')
    expect(wrapper.text()).not.toMatch(/agent[_-]?api[_-]?key/i)
  })
})
