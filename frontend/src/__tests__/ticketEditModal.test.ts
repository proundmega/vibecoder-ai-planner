import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import TicketEditModal from '@/components/TicketEditModal.vue'
import * as ticketsApi from '@/api/tickets'

vi.mock('@/api/tickets', () => ({
  fetchProjectUsers: vi.fn(),
  updateTicket: vi.fn(),
}))

vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({
    user: { value: { id: 100 } },
    canUpdateTicket: () => true,
    hasRole: () => false,
  }),
}))

function mountModal() {
  return mount(TicketEditModal, {
    props: {
      ticket: {
        id: 1,
        title: 'Existing title',
        description: 'Existing description',
        priority: 'high',
        assignee_id: 2,
      },
      projectId: '1',
    },
    global: { stubs: { teleport: true } },
  })
}

describe('TicketEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(ticketsApi.fetchProjectUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 2, name: 'Bob' },
    ])
    ;(ticketsApi.updateTicket as ReturnType<typeof vi.fn>).mockResolvedValue({})
  })

  it('sets title and description maxlengths and exposes critical/urgent priorities', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const title = wrapper.find('input[type="text"]')
    const description = wrapper.find('textarea')
    expect(title.attributes('maxlength')).toBe('200')
    expect(description.attributes('maxlength')).toBe('5000')

    const priorityOptions = wrapper.findAll('select')[0].findAll('option').map(o => o.text())
    expect(priorityOptions).toContain('Critical')
    expect(priorityOptions).toContain('Urgent')
    wrapper.unmount()
  })

  it('sends assigneeId null when Unassigned is selected', async () => {
    const wrapper = mountModal()
    await flushPromises()

    const assigneeSelect = wrapper.findAll('select')[1]
    await assigneeSelect.setValue('')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(ticketsApi.updateTicket).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ assigneeId: null })
    )
    wrapper.unmount()
  })
})
