import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
}))

import * as client from '@/api/client'
import * as agentNodesApi from '@/api/agentNodes'

describe('agentNodes API client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists nodes', async () => {
    ;(client.get as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await agentNodesApi.listAgentNodes()
    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-nodes')
  })

  it('lists, creates and revokes grants', async () => {
    ;(client.get as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 3 })
    ;(client.del as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 3 })

    await agentNodesApi.getAgentNodeGrants(7)
    await agentNodesApi.createAgentGrant(7, { projectId: 5, role: 'planner' })
    await agentNodesApi.revokeAgentGrant(7, 3)

    expect(client.get).toHaveBeenCalledWith('/api/v1/agent-nodes/7/grants')
    expect(client.post).toHaveBeenCalledWith('/api/v1/agent-nodes/7/grants', {
      projectId: 5,
      role: 'planner',
    })
    expect(client.del).toHaveBeenCalledWith('/api/v1/agent-nodes/7/grants/3')
  })

  it('drains and revokes nodes', async () => {
    ;(client.post as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 7 })

    await agentNodesApi.drainAgentNode(7)
    await agentNodesApi.revokeAgentNode(7)

    expect(client.post).toHaveBeenCalledWith('/api/v1/agent-nodes/7/drain')
    expect(client.post).toHaveBeenCalledWith('/api/v1/agent-nodes/7/revoke')
  })

  it('patches a runtime status and effort', async () => {
    ;(client.patch as ReturnType<typeof vi.fn>).mockResolvedValue({ id: 11 })

    await agentNodesApi.updateAgentRuntime(11, { status: 'draining', effort: 'high' })

    expect(client.patch).toHaveBeenCalledWith('/api/v1/agent-runtimes/11', {
      status: 'draining',
      effort: 'high',
    })
  })
})
