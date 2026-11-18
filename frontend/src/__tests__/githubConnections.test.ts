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

import GitHubConnections from '@/views/GitHubConnections.vue'
import { get, post, del } from '@/api/client'

const mockGet = get as ReturnType<typeof vi.fn>
const mockPost = post as ReturnType<typeof vi.fn>
const mockDel = del as ReturnType<typeof vi.fn>

// Shape returned by GitHubService._formatRepoResult.
const repoRow = {
  id: 3,
  projectId: 1,
  provider: 'github',
  repoUrl: 'org/repo',
  defaultBranch: 'main',
  isActive: true,
}

const rawPullRequest = {
  id: 1,
  number: 3,
  title: 'Fix',
  state: 'open',
  url: 'https://github.com/org/repo/pull/3',
  head: 'vibecode/ticket-7-fix',
  base: 'main',
}

describe('GitHubConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/repo')) return Promise.resolve(repoRow)
      if (url.endsWith('/branches')) {
        return Promise.resolve(['vibecode/ticket-7-fix', 'vibecode/ticket-9'])
      }
      if (url.endsWith('/prs')) return Promise.resolve([rawPullRequest])
      return Promise.resolve(null)
    })
    mockPost.mockResolvedValue({ branchName: 'ticket-5', ticketId: '5' })
    mockDel.mockResolvedValue(undefined)
  })

  it('renders the connected state and branch/PR sections from the backend repo shape', async () => {
    const wrapper = mount(GitHubConnections)
    await flushPromises()

    expect(wrapper.text()).toContain('Connected')
    expect(wrapper.text()).toContain('org/repo')
    expect(wrapper.text()).toContain('Default branch: main')
    expect(wrapper.text()).toContain('vibecode/ticket-7-fix')
    expect(wrapper.text()).toContain('vibecode/ticket-9')
    expect(wrapper.text()).not.toContain('Connect Repository')

    const link = wrapper.find('a.pr-link')
    expect(link.attributes('href')).toBe('https://github.com/org/repo/pull/3')
    expect(link.text()).toContain('#3 Fix')
    expect(wrapper.find('.pr-branch').text()).toBe('vibecode/ticket-7-fix')

    expect(mockGet).toHaveBeenCalledWith('/api/v1/github/1/repo')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/github/1/branches')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/github/1/prs')
  })

  it('deletes a branch using the parsed ticket id', async () => {
    const wrapper = mount(GitHubConnections)
    await flushPromises()

    await wrapper.findAll('.btn-delete')[0].trigger('click')
    await flushPromises()

    expect(mockDel).toHaveBeenCalledWith('/api/v1/github/7/branch')
  })

  it('creates a branch without throwing on an undefined ref', async () => {
    const wrapper = mount(GitHubConnections)
    await flushPromises()

    const createButtons = wrapper.findAll('button').filter(button => button.text() === 'Create Branch')
    await createButtons[0].trigger('click')
    await wrapper.find('.modal input').setValue('5')
    await wrapper.find('.modal .btn-primary').trigger('click')
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/github/5/branch', {
      branchName: 'ticket-5',
      projectId: '1',
    })
    expect(wrapper.text()).toContain('Branch created successfully')
  })
})
