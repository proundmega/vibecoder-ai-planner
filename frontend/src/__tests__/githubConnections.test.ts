import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: { id: '1' } }),
}))

vi.mock('@/api/github', () => ({
  getRepoStatus: vi.fn(),
  connectRepo: vi.fn(),
  disconnectRepo: vi.fn(),
  listBranches: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  listPRs: vi.fn(),
  createPR: vi.fn(),
}))

import GitHubConnections from '@/views/GitHubConnections.vue'
import * as githubApi from '@/api/github'

const branch = (name: string, ticketId: string) => ({ name, ticketId })

describe('GitHubConnections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(githubApi.getRepoStatus as ReturnType<typeof vi.fn>).mockResolvedValue({
      connected: true,
      repo_url: 'org/repo',
      default_branch: 'main',
    })
    ;(githubApi.listBranches as ReturnType<typeof vi.fn>).mockResolvedValue([
      branch('vibecode/ticket-7-fix', '7'),
      branch('vibecode/ticket-9', '9'),
    ])
    ;(githubApi.listPRs as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 1,
        number: 3,
        title: 'Fix',
        state: 'open',
        url: 'https://github.com/org/repo/pull/3',
        head: 'vibecode/ticket-7-fix',
        base: 'main',
      },
    ])
  })

  it('renders branches and pull request links from the API shapes', async () => {
    const wrapper = mount(GitHubConnections)
    await flushPromises()

    expect(wrapper.text()).toContain('vibecode/ticket-7-fix')
    expect(wrapper.text()).toContain('vibecode/ticket-9')

    const link = wrapper.find('a.pr-link')
    expect(link.attributes('href')).toBe('https://github.com/org/repo/pull/3')
    expect(link.text()).toContain('#3 Fix')
    expect(wrapper.find('.pr-branch').text()).toBe('vibecode/ticket-7-fix')
  })

  it('deletes a branch using the parsed ticket id', async () => {
    ;(githubApi.deleteBranch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const wrapper = mount(GitHubConnections)
    await flushPromises()

    await wrapper.findAll('.btn-delete')[0].trigger('click')
    await flushPromises()

    expect(githubApi.deleteBranch).toHaveBeenCalledWith('7')
  })

  it('creates a branch without throwing on an undefined ref', async () => {
    ;(githubApi.createBranch as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'ticket-5' })
    ;(githubApi.listBranches as ReturnType<typeof vi.fn>).mockResolvedValue([])

    const wrapper = mount(GitHubConnections)
    await flushPromises()

    const createButtons = wrapper.findAll('button').filter(button => button.text() === 'Create Branch')
    await createButtons[0].trigger('click')
    await wrapper.find('.modal input').setValue('5')
    await wrapper.find('.modal .btn-primary').trigger('click')
    await flushPromises()

    expect(githubApi.createBranch).toHaveBeenCalledWith('5', 'ticket-5', '1')
    expect(wrapper.text()).toContain('Branch created successfully')
  })
})
