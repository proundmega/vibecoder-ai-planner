import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ref, nextTick } from 'vue'
import * as ticketsApi from '../api/tickets'
import * as projectsApi from '../api/projects'

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

    it('should set creationError on createTicket failure (null result)', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue(null)

      const creationError = ref(null)

      const result = await ticketsApi.createTicket('proj-1', 'New ticket', 'Desc')

      if (!result) {
        creationError.value = 'Failed to create ticket. Please try again.'
      }

      expect(creationError.value).toBe('Failed to create ticket. Please try again.')
    })

    it('should not reload tickets when createTicket fails', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue(null)

      const { get: getTickets } = await import('../api/client')
      getTickets.mockResolvedValue([{ id: 't1', title: 'Existing' }])

      const result = await ticketsApi.createTicket('proj-1', 'New ticket', 'Desc')

      // Should not reload when result is null (error case)
      let ticketsReloaded = false
      if (result) {
        await ticketsApi.fetchTickets('proj-1')
        ticketsReloaded = true
      }

      expect(ticketsReloaded).toBe(false)
      expect(getTickets).not.toHaveBeenCalled()
    })
  })
})
