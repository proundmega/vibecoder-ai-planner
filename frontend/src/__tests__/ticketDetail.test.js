import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockRoute, mockRouter, authState } = vi.hoisted(() => ({
  mockRoute: { params: { id: 'p1', ticketId: 't1' }, query: {} },
  mockRouter: { push: vi.fn(), back: vi.fn(), replace: vi.fn() },
  authState: { canUpdate: true },
}))

vi.mock('vue-router', () => ({
  useRoute: () => mockRoute,
  useRouter: () => mockRouter,
  createRouter: vi.fn(() => ({})),
  createWebHistory: vi.fn(() => ({})),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { value: { id: 'u1', role: 'project_admin' } },
    canUpdateTicket: () => authState.canUpdate,
    canDeleteTicket: () => true,
    hasRole: () => false,
  }),
}))

vi.mock('@/api/tickets', () => ({
  fetchTicket: vi.fn(),
  updateTicket: vi.fn(),
  addComment: vi.fn(),
  fetchComments: vi.fn(),
  deleteTicket: vi.fn(),
  dependencyBlockedMessage: () => null,
  fetchProjectUsers: vi.fn(),
}))

vi.mock('@/api/approvals', () => ({
  getTicketApprovals: vi.fn(),
  createApproval: vi.fn(),
}))

vi.mock('@/api/ticketAttachments', () => ({
  fetchAttachments: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
}))

vi.mock('@/api/ticketPlanning', () => ({
  listPlanningFiles: vi.fn(),
  getPlanningFile: vi.fn(),
  upsertPlanningFile: vi.fn(),
  applyTemplate: vi.fn(),
  updatePlanningStatus: vi.fn(),
}))

vi.mock('@/api/client', () => ({
  getTicketPlanningUsage: vi.fn(),
  getPlanningFileUsage: vi.fn(),
}))

vi.mock('@/api/templates', () => ({
  listTemplates: vi.fn(),
}))

import TicketDetail from '@/views/TicketDetail.vue'
import TicketEditModal from '@/components/TicketEditModal.vue'
import * as ticketsApi from '@/api/tickets'
import * as approvalsApi from '@/api/approvals'
import * as attachmentsApi from '@/api/ticketAttachments'
import * as planningApi from '@/api/ticketPlanning'
import * as clientApi from '@/api/client'
import * as templatesApi from '@/api/templates'

function baseTicket(overrides = {}) {
  return {
    id: 't1',
    title: 'Test ticket',
    description: 'Description',
    status: 'backlog',
    priority: 'medium',
    projectId: 'p1',
    ownerId: 'u1',
    ...overrides,
  }
}

async function mountDetail(ticket) {
  ticketsApi.fetchTicket.mockResolvedValue(ticket)
  const wrapper = mount(TicketDetail)
  await flushPromises()
  return wrapper
}

function findButton(wrapper, label) {
  return wrapper.findAll('button').find(button => button.text().includes(label))
}

describe('TicketDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authState.canUpdate = true
    mockRoute.query = {}
    ticketsApi.fetchComments.mockResolvedValue([])
    approvalsApi.getTicketApprovals.mockResolvedValue([])
    attachmentsApi.fetchAttachments.mockResolvedValue([])
    planningApi.listPlanningFiles.mockResolvedValue([])
    clientApi.getTicketPlanningUsage.mockResolvedValue(null)
    templatesApi.listTemplates.mockResolvedValue([])
  })

  it('disables Delete Ticket while the ticket is in progress', async () => {
    const wrapper = await mountDetail(baseTicket({ status: 'in_progress' }))
    const deleteButton = findButton(wrapper, 'Delete Ticket')

    expect(deleteButton).toBeTruthy()
    expect(deleteButton.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.delete-ticket-action').attributes('title')).toContain('Backlog')
    expect(wrapper.find('.delete-hint').text()).toContain('Move this ticket to Backlog')
  })

  it('allows deleting a backlog ticket', async () => {
    const wrapper = await mountDetail(baseTicket({ status: 'backlog' }))
    const deleteButton = findButton(wrapper, 'Delete Ticket')

    expect(deleteButton).toBeTruthy()
    expect(deleteButton.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.delete-hint').exists()).toBe(false)
  })

  it('shows the delete failure without reopening the confirmation modal', async () => {
    ticketsApi.deleteTicket.mockRejectedValue(
      new Error('Cannot delete a ticket that is in progress. Move it to backlog first.')
    )

    const wrapper = await mountDetail(baseTicket())
    await findButton(wrapper, 'Delete Ticket').trigger('click')
    await flushPromises()

    expect(wrapper.find('.delete-confirm').exists()).toBe(true)
    await wrapper.find('.delete-confirm .btn-submit').trigger('click')
    await flushPromises()

    expect(ticketsApi.deleteTicket).toHaveBeenCalledWith('t1')
    expect(wrapper.find('.delete-confirm').exists()).toBe(false)
    expect(wrapper.find('.error-banner').text()).toContain('Move it to backlog first')
  })

  it('renders the planning file Edit action with the styled VButton and shows the saved message', async () => {
    planningApi.listPlanningFiles.mockResolvedValue([
      { key: 'planning.md', status: 'draft', last_cost_usd: 0 },
    ])
    planningApi.getPlanningFile.mockResolvedValue({ content: 'existing plan' })
    planningApi.upsertPlanningFile.mockResolvedValue({})

    const wrapper = await mountDetail(baseTicket())

    // loadPlanning() opens the main file in the editor; cancel back to the list
    // to reach the row-level Edit action.
    const cancelButton = findButton(wrapper, 'Cancel')
    await cancelButton.trigger('click')
    await flushPromises()

    const planningFile = wrapper.find('.planning-file')

    expect(planningFile.exists()).toBe(true)
    const editButton = planningFile.find('button.v-btn')
    expect(editButton.exists()).toBe(true)
    expect(editButton.text()).toBe('Edit')

    await editButton.trigger('click')
    await flushPromises()

    await wrapper.find('.editor-textarea').setValue('updated plan')
    await wrapper.find('.btn-submit').trigger('click')
    await flushPromises()

    expect(planningApi.upsertPlanningFile).toHaveBeenCalledWith('t1', 'planning.md', 'updated plan')
    expect(wrapper.find('.success').exists()).toBe(true)
    expect(wrapper.find('.success').text()).toBe('Planning file saved')
  })

  it('opens the Edit Ticket modal by default when the board navigates with ?edit=1', async () => {
    mockRoute.query = { edit: '1' }

    const wrapper = await mountDetail(baseTicket())

    expect(wrapper.findComponent(TicketEditModal).exists()).toBe(true)
  })

  it('keeps the Edit Ticket modal closed without the query flag', async () => {
    const wrapper = await mountDetail(baseTicket())

    expect(wrapper.findComponent(TicketEditModal).exists()).toBe(false)
  })

  it('does not auto-open the edit modal without update permission and strips the query', async () => {
    mockRoute.query = { edit: '1' }
    authState.canUpdate = false

    const wrapper = await mountDetail(baseTicket())

    expect(wrapper.findComponent(TicketEditModal).exists()).toBe(false)
    expect(mockRouter.replace).toHaveBeenCalledWith({ query: {} })
  })

  it('auto-opens the edit modal even when unrelated data fetches fail', async () => {
    mockRoute.query = { edit: '1' }
    ticketsApi.fetchComments.mockRejectedValue(new Error('comments unavailable'))

    const wrapper = await mountDetail(baseTicket())

    expect(wrapper.findComponent(TicketEditModal).exists()).toBe(true)
  })

  it('strips the edit query when the edit modal is closed', async () => {
    mockRoute.query = { edit: '1' }

    const wrapper = await mountDetail(baseTicket())
    const modal = wrapper.findComponent(TicketEditModal)
    expect(modal.exists()).toBe(true)

    modal.vm.$emit('close')
    await flushPromises()

    expect(mockRouter.replace).toHaveBeenCalledWith({ query: {} })
    expect(wrapper.findComponent(TicketEditModal).exists()).toBe(false)
  })

  it('refetches the ticket after a 409 delete conflict', async () => {
    ticketsApi.fetchTicket
      .mockResolvedValueOnce(baseTicket())
      .mockResolvedValueOnce(baseTicket({ status: 'in_progress' }))
    ticketsApi.deleteTicket.mockRejectedValue(
      Object.assign(new Error('Cannot delete a ticket that is in progress.'), { status: 409 })
    )

    const wrapper = mount(TicketDetail)
    await flushPromises()

    await findButton(wrapper, 'Delete Ticket').trigger('click')
    await flushPromises()
    await wrapper.find('.delete-confirm .btn-submit').trigger('click')
    await flushPromises()

    expect(ticketsApi.fetchTicket).toHaveBeenCalledTimes(2)
    const deleteButton = findButton(wrapper, 'Delete Ticket')
    expect(deleteButton.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.delete-hint').exists()).toBe(true)
  })
})
