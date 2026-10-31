import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'

vi.mock('@/api/users', () => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  toggleUserActive: vi.fn(),
  deleteUser: vi.fn(),
}))

vi.mock('@/api/projects', () => ({
  fetchProjects: vi.fn(),
}))

vi.mock('@/api/usage', () => ({
  getUserUsage: vi.fn(),
  getModelPricing: vi.fn(),
  getProjectUsage: vi.fn(),
}))

vi.mock('@/api/agents', () => ({
  fetchAgentStatusList: vi.fn(),
}))

vi.mock('@/api/tickets', () => ({
  fetchProjectUsers: vi.fn(),
  updateTicket: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), currentRoute: { value: { path: '/' } } }),
  useRoute: () => ({ params: {} }),
}))

import UserManagement from '@/views/UserManagement.vue'
import Dashboard from '@/views/Dashboard.vue'
import TicketEditModal from '@/components/TicketEditModal.vue'
import { useAuthStore } from '@/stores/auth'
import * as usersApi from '@/api/users'
import * as projectsApi from '@/api/projects'
import * as usageApi from '@/api/usage'
import * as agentsApi from '@/api/agents'
import * as ticketsApi from '@/api/tickets'

function signIn(role = 'project_admin', permissions: string[] = []) {
  localStorage.clear()
  const store = useAuthStore()
  store.setUser({ id: 'admin-1', name: 'Admin', email: 'admin@test.com', role })
  store.setPermissions(permissions)
}

describe('template ref access regressions', () => {
  let wrapper: VueWrapper | null = null

  beforeEach(() => {
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('hides the activate/deactivate button for the signed-in user', async () => {
    signIn('project_admin', ['USER_TOGGLE_ACTIVE'])
    ;(usersApi.listUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
      users: [
        { id: 'admin-1', name: 'Admin', email: 'admin@test.com', role: 'project_admin', isActive: true },
        { id: '2', name: 'Bob', email: 'bob@example.com', role: 'user', isActive: true },
      ],
    })

    wrapper = mount(UserManagement)
    await flushPromises()

    expect(wrapper.findAll('.btn-toggle')).toHaveLength(1)
    expect(wrapper.find('.btn-toggle').text()).toContain('Deactivate')
  })

  it('greets the signed-in user by name on the dashboard', async () => {
    signIn('project_admin')
    ;(projectsApi.fetchProjects as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(usageApi.getUserUsage as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(usageApi.getModelPricing as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(usageApi.getProjectUsage as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(agentsApi.fetchAgentStatusList as ReturnType<typeof vi.fn>).mockResolvedValue([])

    wrapper = mount(Dashboard)
    await flushPromises()

    expect(wrapper.find('.welcome').text()).toContain('Admin')
    expect(wrapper.find('.welcome').text()).not.toContain('Welcome back, User')
  })

  it('preselects the current assignee in the ticket edit modal', async () => {
    signIn('project_admin', ['TICKET_UPDATE'])
    ;(ticketsApi.fetchProjectUsers as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: '9', name: 'Alice', email: 'alice@example.com' },
    ])

    wrapper = mount(TicketEditModal, {
      attachTo: document.body,
      props: {
        ticket: {
          id: '1',
          title: 'Fix login',
          description: 'desc',
          priority: 'medium',
          assigneeId: '9',
        },
        projectId: '1',
      },
    })
    await flushPromises()

    const selects = Array.from(document.body.querySelectorAll('select'))
    const assigneeSelect = selects[selects.length - 1] as HTMLSelectElement
    expect(assigneeSelect.value).toBe('9')
  })
})
