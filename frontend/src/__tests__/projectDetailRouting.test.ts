import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

const githubLoad = vi.hoisted(() => vi.fn())

vi.mock('@/composables/useGitHub', async () => {
  const { ref } = await import('vue')
  return {
    useGitHub: () => ({
      repo: ref(null), loading: ref(false), error: ref(null), success: ref(null),
      showConnectForm: ref(false), repoUrl: ref(''), repoBranch: ref('main'), repoAccessToken: ref(''),
      branches: ref([]), prs: ref([]), creatingBranch: ref(false), branchTicketId: ref(''),
      loaded: ref(false), load: githubLoad, connect: vi.fn(), disconnect: vi.fn(), createBranch: vi.fn(),
    }),
  }
})

vi.mock('@/composables/useUsage', async () => {
  const { ref } = await import('vue')
  return {
    useUsage: () => ({
      usage: ref(null), usageLoading: ref(false), usageError: ref(null),
      billing: ref(null), billingLoading: ref(false), billingError: ref(null),
      loadUsage: vi.fn(), loadBilling: vi.fn(),
    }),
  }
})

vi.mock('@/composables/useMemory', async () => {
  const { ref } = await import('vue')
  return {
    useMemory: () => ({
      memories: ref([]), memoryLoading: ref(false), memoryError: ref(null),
      showAddMemory: ref(false), searchQuery: ref(''), searchResults: ref([]),
      isSearching: ref(false), editingMemory: ref(null), editMemoryContent: ref(''),
      memorySaving: ref(false), memoryDeleting: ref(null),
      load: vi.fn(), handleSearch: vi.fn(), clearSearch: vi.fn(),
      handleAdd: vi.fn(), handleUpdate: vi.fn(), handleDelete: vi.fn(),
    }),
  }
})

import ProjectDetail from '@/views/ProjectDetail.vue'

const GitHubChild = { template: '<div class="github-child">GitHub child</div>' }
const TicketsChild = { template: '<div class="tickets-child">Tickets child</div>' }

async function makeRouter(path: string): Promise<Router> {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/projects/:id',
        name: 'ProjectDetail',
        component: ProjectDetail,
        children: [
          { path: 'github', name: 'ProjectGitHub', component: GitHubChild },
          { path: 'tickets', name: 'ProjectTickets', component: TicketsChild },
          { path: 'templates', name: 'ProjectTemplates', component: { template: '<div />' } },
          { path: 'harness', name: 'ProjectHarness', component: { template: '<div />' } },
        ],
      },
    ],
  })
  await router.push(path)
  await router.isReady()
  return router
}

async function mountAt(path: string) {
  const router = await makeRouter(path)
  const wrapper = mount({ template: '<router-view />' }, { global: { plugins: [router] } })
  await flushPromises()
  return { router, wrapper }
}

describe('ProjectDetail child routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the GitHub child route when Manage GitHub is clicked', async () => {
    const { router, wrapper } = await mountAt('/projects/1')

    const githubTab = wrapper.findAll('button').find(button => button.text() === 'GitHub')
    expect(githubTab).toBeTruthy()
    await githubTab!.trigger('click')
    await flushPromises()

    const manageLink = wrapper.findAll('a').find(link => link.text() === 'Manage GitHub')
    expect(manageLink).toBeTruthy()
    await manageLink!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/projects/1/github')
    expect(wrapper.find('.github-child').exists()).toBe(true)
  })

  it('renders a directly loaded child route and highlights its tab', async () => {
    const { wrapper } = await mountAt('/projects/1/github')

    expect(wrapper.find('.github-child').exists()).toBe(true)
    const githubTab = wrapper.findAll('button').find(button => button.text() === 'GitHub')
    expect(githubTab?.classes()).toContain('active')
  })

  it('loads the active tab after returning from a directly loaded child route', async () => {
    const router = await makeRouter('/projects/1')
    await router.push('/projects/1/github')
    mount({ template: '<router-view />' }, { global: { plugins: [router] } })
    await flushPromises()

    expect(githubLoad).not.toHaveBeenCalled()

    await router.back()
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/projects/1')
    expect(githubLoad).toHaveBeenCalledTimes(1)
  })
})
