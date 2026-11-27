import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
}))

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

import GitConnections from '@/views/GitConnections.vue'
import { get, post, del } from '@/api/client'

const mockGet = get as ReturnType<typeof vi.fn>
const mockPost = post as ReturnType<typeof vi.fn>
const mockDel = del as ReturnType<typeof vi.fn>

const providers = [
  {
    id: 'github', label: 'GitHub', supportsReviewRequests: true,
    supportsInstallations: true, requiresBaseUrl: false,
    reviewRequestName: 'pull request', authModes: ['app', 'pat'], registered: true,
  },
  {
    id: 'forgejo', label: 'Forgejo', supportsReviewRequests: true,
    supportsInstallations: false, requiresBaseUrl: true,
    reviewRequestName: 'pull request', authModes: ['pat', 'project_token'], registered: true,
  },
]

const repoRow = {
  id: 3,
  projectId: 1,
  provider: 'forgejo',
  repoUrl: 'https://git.example.com/group/repo.git',
  defaultBranch: 'main',
  isActive: true,
  authMode: 'pat',
  providerBaseUrl: 'https://git.example.com',
}

function connectedBackend() {
  mockGet.mockImplementation((url: string) => {
    if (url.endsWith('/providers')) return Promise.resolve(providers)
    if (url.endsWith('/repos')) return Promise.resolve([repoRow])
    if (url.includes('/repo')) return Promise.resolve(repoRow)
    if (url.includes('/branches')) return Promise.resolve(['vibecode/ticket-7-fix'])
    if (url.includes('/reviews')) {
      return Promise.resolve([{
        number: 3,
        url: 'https://git.example.com/group/repo/pulls/3',
        state: 'open',
      }])
    }
    return Promise.resolve(null)
  })
}

describe('GitConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ branchName: 'vibecode/ticket-9' })
    mockDel.mockResolvedValue(undefined)
  })

  it('shows the provider, connection status, branches and reviews', async () => {
    connectedBackend()
    const wrapper = mount(GitConnections)
    await flushPromises()

    expect(wrapper.text()).toContain('Git Connections')
    expect(wrapper.text()).toContain('Forgejo')
    expect(wrapper.text()).toContain('https://git.example.com/group/repo.git')
    expect(wrapper.text()).toContain('Default branch: main')
    expect(wrapper.text()).toContain('Latest review #3 (open)')
    expect(wrapper.text()).toContain('vibecode/ticket-7-fix')
    expect(wrapper.text()).toContain('#3 review')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/git/1/repos')
  })

  it('connects a self-hosted provider with base URL and token', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/providers')) return Promise.resolve(providers)
      if (url.endsWith('/repos')) return Promise.resolve([])
      if (url.includes('/repo')) return Promise.resolve(null)
      return Promise.resolve([])
    })

    const wrapper = mount(GitConnections)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === 'Connect repository')!.trigger('click')
    const selects = wrapper.findAll('select')
    await selects[0].setValue('forgejo')

    await wrapper.find('input[placeholder="owner/repo"]').setValue('group/repo')
    await wrapper.find('input[placeholder="https://git.example.com"]').setValue('https://git.example.com')
    await wrapper.find('input[placeholder="Scoped repository token"]').setValue('scoped-token')
    await wrapper.findAll('button').find((button) => button.text() === 'Connect')!.trigger('click')
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/1/repo/connect', {
      provider: 'forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      authMode: 'pat',
      token: 'scoped-token',
    })
  })

  it('creates a branch and a review for a ticket', async () => {
    connectedBackend()
    const wrapper = mount(GitConnections)
    await flushPromises()

    await wrapper.find('input[placeholder="Ticket ID"]').setValue('7')
    const branchButton = wrapper.findAll('button').find((button) => button.text() === 'Create branch')!
    await branchButton.trigger('click')
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/7/branch', { provider: 'forgejo' })

    await wrapper.findAll('input[placeholder="Ticket ID"]')[1].setValue('9')
    await wrapper.find('input[placeholder="Description (optional)"]').setValue('Review body')
    const reviewButton = wrapper.findAll('button')
      .find((button) => button.text() === 'Create pull request')!
    await reviewButton.trigger('click')
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/9/review', {
      description: 'Review body',
      provider: 'forgejo',
    })
  })

  it('never renders an unsafe provider review URL as a link', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/providers')) return Promise.resolve(providers)
      if (url.endsWith('/repos')) return Promise.resolve([repoRow])
      if (url.includes('/repo')) return Promise.resolve(repoRow)
      if (url.includes('/branches')) return Promise.resolve([])
      if (url.includes('/reviews')) {
        return Promise.resolve([{ number: 9, url: 'javascript:alert(1)', state: 'open' }])
      }
      return Promise.resolve(null)
    })

    const wrapper = mount(GitConnections)
    await flushPromises()

    expect(wrapper.find('a[href^="javascript"]').exists()).toBe(false)
    expect(wrapper.find('a.review-link').exists()).toBe(false)
    expect(wrapper.text()).toContain('#9 review (URL unavailable)')
  })

  it('keeps branch/review controls when capabilities fail but the repo is not local', async () => {
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/providers')) return Promise.reject(new Error('providers down'))
      if (url.endsWith('/repos')) return Promise.resolve([repoRow])
      if (url.includes('/repo')) return Promise.resolve(repoRow)
      if (url.includes('/branches')) return Promise.resolve(['vibecode/ticket-7-fix'])
      if (url.includes('/reviews')) {
        return Promise.resolve([{
          number: 3,
          url: 'https://git.example.com/group/repo/pulls/3',
          state: 'open',
        }])
      }
      return Promise.resolve(null)
    })

    const wrapper = mount(GitConnections)
    await flushPromises()

    expect(wrapper.text()).not.toContain('Branch-only provider')
    expect(wrapper.text()).toContain('Branches')
    expect(wrapper.text()).toContain('Reviews')
  })

  it('shows only the agent-managed note for a local repository', async () => {
    const localRepo = {
      ...repoRow,
      provider: 'local',
      repoUrl: 'ssh://git@git.example.com/group/repo.git',
      authMode: 'ssh',
      providerBaseUrl: null,
    }
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/providers')) return Promise.resolve(providers)
      if (url.endsWith('/repos')) return Promise.resolve([localRepo])
      if (url.includes('/repo')) return Promise.resolve(localRepo)
      if (url.includes('/branches')) return Promise.resolve([])
      if (url.includes('/reviews')) return Promise.resolve([])
      return Promise.resolve(null)
    })

    const wrapper = mount(GitConnections)
    await flushPromises()

    expect(wrapper.text()).toContain('Branch-only provider')
    expect(wrapper.text()).not.toContain('Create branch')
    expect(wrapper.text()).not.toContain('Create pull request')
  })

  it('disconnects the active provider', async () => {
    connectedBackend()
    const wrapper = mount(GitConnections)
    await flushPromises()

    await wrapper.findAll('button').find((button) => button.text() === 'Disconnect')!.trigger('click')
    await flushPromises()

    expect(mockDel).toHaveBeenCalledWith('/api/v1/git/1/repo?provider=forgejo')
  })
})
