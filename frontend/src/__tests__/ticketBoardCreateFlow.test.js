import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRoute, mockRouter } = vi.hoisted(() => ({
  mockRoute: { params: { id: 'p1' } },
  mockRouter: { push: vi.fn() },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { value: { id: 'u1', role: 'project_admin' } },
    canCreateTicket: () => true,
    canUpdateTicket: () => true,
  }),
}))

vi.mock('@/api/projects', () => ({
  fetchProjects: vi.fn(),
}))

vi.mock('@/api/tickets', () => ({
  fetchTickets: vi.fn(),
  fetchTicket: vi.fn(),
  updateTicket: vi.fn(),
  createTicket: vi.fn(),
  blockerSummary: () => null,
  dependencyBlockedMessage: () => null,
  readinessIssueSummary: () => null,
}))

import TicketBoard from '@/views/TicketBoard.vue'
import * as projectsApi from '@/api/projects'
import * as ticketsApi from '@/api/tickets'

async function openCreateModalAndSubmit(wrapper) {
  await wrapper.find('.btn-primary').trigger('click')
  await wrapper.find('input[type="text"]').setValue('New ticket')
  await wrapper.find('textarea').setValue('Details')
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('TicketBoard create flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    projectsApi.fetchProjects.mockResolvedValue([{ id: 'p1', name: 'Project' }])
    ticketsApi.fetchTickets.mockResolvedValue([])
  })

  it('opens the new ticket in the Edit Ticket view after saving', async () => {
    ticketsApi.createTicket.mockResolvedValue({
      id: 't1',
      projectId: 'p1',
      title: 'New ticket',
      status: 'backlog',
    })

    const wrapper = mount(TicketBoard)
    await flushPromises()
    await openCreateModalAndSubmit(wrapper)

    expect(ticketsApi.createTicket).toHaveBeenCalledWith('p1', 'New ticket', 'Details')
    expect(mockRouter.push).toHaveBeenCalledWith({
      name: 'TicketDetail',
      params: { id: 'p1', ticketId: 't1' },
      query: { edit: '1' },
    })
  })

  it('keeps the modal open and surfaces the error when creation fails', async () => {
    ticketsApi.createTicket.mockRejectedValue(new Error('Creation failed'))

    const wrapper = mount(TicketBoard)
    await flushPromises()
    await openCreateModalAndSubmit(wrapper)

    expect(mockRouter.push).not.toHaveBeenCalled()
    expect(wrapper.find('.creation-error').exists()).toBe(true)
    expect(wrapper.text()).toContain('Create New Ticket')
  })
})
