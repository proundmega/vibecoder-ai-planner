import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory, type Router } from 'vue-router'

const gitLoad = vi.hoisted(() => vi.fn())

vi.mock('@/composables/useGit', async () => {
  const { ref, computed } = await import('vue')
  return {
    useGit: () => ({
      repo: ref(null), repos: ref([]), providers: ref([]), registeredProviders: computed(() => []),
      activeProvider: ref(''), activeRepo: computed(() => null),
      activeCapabilities: computed(() => null), formCapabilities: computed(() => null),
      loading: ref(false), error: ref(null), success: ref(null),
      showConnectForm: ref(false), form: ref({}), branches: ref([]), reviews: ref([]),
      actionLoading: ref(null), providerLabel: (id: string) => id,
      applyProviderDefaults: vi.fn(), load: gitLoad, connect: vi.fn(), disconnect: vi.fn(),
      createBranch: vi.fn(), deleteBranch: vi.fn(), createReview: vi.fn(),
      loadBranches: vi.fn(), loadReviews: vi.fn(),
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

const GitChild = { template: '<div class="git-child">Git child</div>' }
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
          { path: 'git', name: 'ProjectGit', component: GitChild },
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

  it('renders the Git child route when Manage Git is clicked', async () => {
    const { router, wrapper } = await mountAt('/projects/1')

    const gitTab = wrapper.findAll('button').find(button => button.text() === 'Git')
    expect(gitTab).toBeTruthy()
    await gitTab!.trigger('click')
    await flushPromises()

    const manageLink = wrapper.findAll('a').find(link => link.text() === 'Manage Git')
    expect(manageLink).toBeTruthy()
    await manageLink!.trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/projects/1/git')
    expect(wrapper.find('.git-child').exists()).toBe(true)
  })

  it('renders a directly loaded child route and highlights its tab', async () => {
    const { wrapper } = await mountAt('/projects/1/git')

    expect(wrapper.find('.git-child').exists()).toBe(true)
    const gitTab = wrapper.findAll('button').find(button => button.text() === 'Git')
    expect(gitTab?.classes()).toContain('active')
  })

  it('loads the active tab after returning from a directly loaded child route', async () => {
    const router = await makeRouter('/projects/1')
    await router.push('/projects/1/git')
    mount({ template: '<router-view />' }, { global: { plugins: [router] } })
    await flushPromises()

    expect(gitLoad).not.toHaveBeenCalled()

    await router.back()
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/projects/1')
    expect(gitLoad).toHaveBeenCalledTimes(1)
  })
})
