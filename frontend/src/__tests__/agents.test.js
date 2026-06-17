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

  it('createTicket calls postWithHeaders with correct URL and headers', async () => {
    const { postWithHeaders } = await import('../api/client')
    postWithHeaders.mockResolvedValue({ id: 't1', title: 'Test ticket' })

    await agents.createTicket('proj-1', 'Test ticket', 'Description', 'agent-key-123')

    expect(postWithHeaders).toHaveBeenCalledWith(
      '/api/v1/agents/tickets/create',
      { projectId: 'proj-1', title: 'Test ticket', description: 'Description' },
      { 'x-api-key': 'agent-key-123' },
    )
  })

  it('createTicket works without API key', async () => {
    const { postWithHeaders } = await import('../api/client')
    postWithHeaders.mockResolvedValue({ id: 't1' })

    await agents.createTicket('proj-1', 'Test ticket', 'Description')

    expect(postWithHeaders).toHaveBeenCalledWith(
      '/api/v1/agents/tickets/create',
      { projectId: 'proj-1', title: 'Test ticket', description: 'Description' },
      {},
    )
  })

  it('updateTicket calls postWithHeaders with correct URL', async () => {
    const { postWithHeaders } = await import('../api/client')
    postWithHeaders.mockResolvedValue({ id: 't1', title: 'Updated' })

    await agents.updateTicket('t1', { title: 'Updated' }, 'agent-key')

    expect(postWithHeaders).toHaveBeenCalledWith(
      '/api/v1/agents/agents/tickets/edit/t1',
      { title: 'Updated' },
      { 'x-api-key': 'agent-key' },
    )
  })

  it('claimTicket calls postWithHeaders with correct URL', async () => {
    const { postWithHeaders } = await import('../api/client')
    postWithHeaders.mockResolvedValue({ id: 't1', status: 'in_progress' })

    await agents.claimTicket('t1', 'agent-key')

    expect(postWithHeaders).toHaveBeenCalledWith(
      '/api/v1/agents/agents/tickets/claim/t1',
      {},
      { 'x-api-key': 'agent-key' },
    )
  })

  it('changeTicketStatus calls postWithHeaders with correct URL and status', async () => {
    const { postWithHeaders } = await import('../api/client')
    postWithHeaders.mockResolvedValue({ id: 't1', status: 'review' })

    await agents.changeTicketStatus('t1', 'review', 'agent-key')

    expect(postWithHeaders).toHaveBeenCalledWith(
      '/api/v1/agents/agents/tickets/status/t1',
      { status: 'review' },
      { 'x-api-key': 'agent-key' },
    )
  })

  it('getAgentTickets calls get with correct URL and options', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 't1' }, { id: 't2' }])

    await agents.getAgentTickets('proj-1', 'agent-key')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agents/tickets/my-tasks/proj-1', {
      headers: { 'x-api-key': 'agent-key' },
    })
  })

  it('getAgentTickets works without API key', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 't1' }])

    await agents.getAgentTickets('proj-1')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agents/tickets/my-tasks/proj-1', {})
  })

  it('getAgentKeyInfo calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue({ key: 'ak_123' })

    await agents.getAgentKeyInfo('agent-1')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agents/agent-1/key')
  })

  it('createAgent calls post with correct URL', async () => {
    const { post } = await import('../api/client')
    post.mockResolvedValue({ id: 'agent-1', name: 'Test Agent' })

    await agents.createAgent('Test Agent')

    expect(post).toHaveBeenCalledWith('/api/v1/agents/agents/create', { name: 'Test Agent' })
  })

  it('listAgents calls get with correct URL', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'agent-1', name: 'Agent 1' }])

    await agents.listAgents()

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agents')
  })

  it('getAgentHistory calls get with correct URL and options', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'h1', action: 'ticket_update' }])

    await agents.getAgentHistory('agent-1', 'agent-key')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agents/agent-1/history', {
      headers: { 'x-api-key': 'agent-key' },
    })
  })

  it('getAgentHistory works without API key', async () => {
    const { get } = await import('../api/client')
    get.mockResolvedValue([{ id: 'h1' }])

    await agents.getAgentHistory('agent-1')

    expect(get).toHaveBeenCalledWith('/api/v1/agents/agents/agent-1/history', {})
  })
})
