import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref } from 'vue'
import * as ticketsApi from '../api/tickets'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: ref({ id: 'user-1', role: 'project_admin' }),
    canCreateTicket: () => true,
    canUpdateTicket: () => true,
  }),
}))

describe('TicketBoard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('summarizes the first dependency blocker for the card badge', () => {
    expect(
      ticketsApi.blockerSummary({
        id: '10',
        title: 'Dependent',
        status: 'backlog',
        priority: 'medium',
        projectId: '1',
        ready: false,
        blockedBy: [{ id: '5', title: 'Create the schema', reason: 'not_done' }],
      })
    ).toBe('Create the schema')

    expect(
      ticketsApi.blockerSummary({
        id: '10',
        title: 'Dependent',
        status: 'backlog',
        priority: 'medium',
        projectId: '1',
        ready: false,
        blockedBy: [{ id: '9', title: null, reason: 'missing' }],
      })
    ).toBe('missing')

    expect(
      ticketsApi.blockerSummary({
        id: '10',
        title: 'Ready',
        status: 'backlog',
        priority: 'medium',
        projectId: '1',
        ready: true,
      })
    ).toBeNull()
  })

  it('formats 409 dependency details for the board error surface', () => {
    expect(
      ticketsApi.dependencyBlockedMessage({
        blockedBy: [{ id: '5', title: 'Create the schema', reason: 'not_done' }],
      })
    ).toBe('Create the schema')

    expect(
      ticketsApi.dependencyBlockedMessage({
        blockedBy: [{ id: '9', title: null, reason: 'missing' }],
      })
    ).toBe('#9')

    expect(
      ticketsApi.dependencyBlockedMessage({
        blockedBy: [{ id: null, title: null, reason: 'unreadable' }],
      })
    ).toBe('unreadable')

    expect(ticketsApi.dependencyBlockedMessage(undefined)).toBeNull()
  })

  describe('createTicket optimistic update', () => {
    it('should call createTicket API and then reload tickets on success', async () => {
      const { post } = await import('../api/client')
      const mockTicket = { id: 't1', title: 'New ticket', status: 'backlog' }
      post.mockResolvedValue(mockTicket)

      const mockTickets = [{ id: 't2', title: 'Existing', status: 'backlog' }]
      const { get: getTickets } = await import('../api/client')
      getTickets.mockResolvedValue([mockTicket, ...mockTickets])

      const { get: getProjects } = await import('../api/client')
      getProjects.mockResolvedValue([{ id: 'proj-1', name: 'Test Project' }])

      // Simulate the component's create + reload flow
      const selectedProjectId = 'proj-1'
      const newTicketTitle = 'New ticket'
      const newTicketDesc = 'Description'

      // Step 1: create ticket
      const result = await ticketsApi.createTicket(selectedProjectId, newTicketTitle, newTicketDesc)

      expect(post).toHaveBeenCalledWith('/api/v1/tickets', {
        projectId: selectedProjectId,
        title: newTicketTitle,
        description: newTicketDesc,
      })

      // Step 2: reload tickets (only on success - when result is truthy)
      if (result) {
        await ticketsApi.fetchTickets(selectedProjectId)
      }

      expect(getTickets).toHaveBeenCalledWith('/api/v1/projects/proj-1/tickets')
    })

    it('should propagate createTicket errors instead of resolving null (fg-45)', async () => {
      const { post } = await import('../api/client')
      post.mockRejectedValue(new Error('Creation failed'))

      await expect(
        ticketsApi.createTicket('proj-1', 'New ticket', 'Desc')
      ).rejects.toThrow('Creation failed')
    })

    it('should not reload tickets when createTicket fails', async () => {
      const { post, get: getTickets } = await import('../api/client')
      post.mockRejectedValue(new Error('Creation failed'))
      getTickets.mockResolvedValue([{ id: 't1', title: 'Existing' }])

      let ticketsReloaded = false
      try {
        await ticketsApi.createTicket('proj-1', 'New ticket', 'Desc')
        await ticketsApi.fetchTickets('proj-1')
        ticketsReloaded = true
      } catch {
        // Expected: the caller surfaces the error and does not reload.
      }

      expect(ticketsReloaded).toBe(false)
      expect(getTickets).not.toHaveBeenCalled()
    })
  })
})
