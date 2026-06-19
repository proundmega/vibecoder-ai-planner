import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agents from '../api/agents'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  postWithHeaders: vi.fn(),
}))

describe('agents API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('getAgentKeyInfo calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue({ key: 'ak_123' })

    await agents.getAgentKeyInfo('agent-1')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agent-1/key')
  })

  it('createAgent calls post with correct URL', async () => {
    const { post } = await import('../api/client')
    post.mockResolvedValue({ id: 'agent-1', name: 'Test Agent' })

    await agents.createAgent('Test Agent')

    expect(post).toHaveBeenCalledWith('/api/v1/agents/create', { name: 'Test Agent' })
  })

  it('listAgents calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1' }])

    await agents.listAgents()

    expect(get).toHaveBeenCalledWith('/api/v1/agents/')
  })

  it('getAgentHistory calls get with correct URL and options', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'h1', action: 'ticket_update' }])

    await agents.getAgentHistory('agent-1', 'agent-key')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agent-1/history', {
      headers: { 'x-api-key': 'agent-key' },
    })
  })

  it('getAgentHistory works without API key', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'h1' }])

    await agents.getAgentHistory('agent-1')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agent-1/history', {})
  })
})
