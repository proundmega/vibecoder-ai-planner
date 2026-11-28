import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { useGit } from '@/composables/useGit'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

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
  {
    id: 'local', label: 'Local', supportsReviewRequests: false,
    supportsInstallations: false, requiresBaseUrl: false,
    reviewRequestName: 'branch', authModes: ['ssh', 'none'], registered: true,
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

describe('useGit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    mockPost.mockResolvedValue({ branchName: 'vibecode/ticket-5' })
    mockDel.mockResolvedValue(undefined)
  })

  it('starts empty', () => {
    const git = useGit(1)
    expect(git.repo.value).toBeNull()
    expect(git.repos.value).toEqual([])
    expect(git.branches.value).toEqual([])
    expect(git.reviews.value).toEqual([])
    expect(git.loading.value).toBe(false)
  })

  it('loads provider-neutral connections, branches and reviews', async () => {
    const git = useGit(1)

    await git.load()
    await flushPromises()

    expect(git.repo.value?.provider).toBe('forgejo')
    expect(git.repos.value).toHaveLength(1)
    expect(git.activeProvider.value).toBe('forgejo')
    expect(git.branches.value).toEqual([{ name: 'vibecode/ticket-7-fix', ticketId: '7' }])
    expect(git.reviews.value[0]).toMatchObject({ number: 3, state: 'open' })
    expect(mockGet).toHaveBeenCalledWith('/api/v1/git/providers')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/git/1/repos')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/git/1/repo')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/git/1/branches?provider=forgejo')
    expect(mockGet).toHaveBeenCalledWith('/api/v1/git/1/reviews?provider=forgejo')
  })

  it('connects a provider with its base URL and token', async () => {
    const git = useGit(1)
    git.form.provider = 'forgejo'
    git.form.repoUrl = 'group/repo'
    git.form.baseUrl = 'https://git.example.com'
    git.form.authMode = 'pat'
    git.form.token = 'scoped-token'

    await git.connect()
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/1/repo/connect', {
      provider: 'forgejo',
      repoUrl: 'group/repo',
      baseUrl: 'https://git.example.com',
      authMode: 'pat',
      token: 'scoped-token',
    })
    expect(git.showConnectForm.value).toBe(false)
  })

  it('defaults local connections to no credential', async () => {
    const git = useGit(1)
    await git.load()
    await flushPromises()

    git.applyProviderDefaults('local')

    expect(git.form.authMode).toBe('none')
    expect(git.form.token).toBe('')
  })

  it('connects a local repository without sending a credential', async () => {
    const git = useGit(1)
    git.form.provider = 'local'
    git.form.repoUrl = 'file:///srv/git/repo.git'
    git.form.authMode = 'none'
    git.form.token = 'stale-token'

    await git.connect()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/1/repo/connect', {
      provider: 'local',
      repoUrl: 'file:///srv/git/repo.git',
      authMode: 'none',
    })
  })

  it('disconnects the requested provider', async () => {
    const git = useGit(1)
    await git.load()
    await flushPromises()

    await git.disconnect('forgejo')

    expect(mockDel).toHaveBeenCalledWith('/api/v1/git/1/repo?provider=forgejo')
  })

  it('creates and deletes ticket branches through the generic routes', async () => {
    const git = useGit(1)
    await git.load()
    await flushPromises()

    await git.createBranch('5')
    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/5/branch', { provider: 'forgejo' })

    await git.deleteBranch('7')
    expect(mockDel).toHaveBeenCalledWith('/api/v1/git/7/branch?provider=forgejo')
  })

  it('creates a review for the ticket', async () => {
    const git = useGit(1)
    await git.load()
    await flushPromises()

    await git.createReview('9', 'PR body')

    expect(mockPost).toHaveBeenCalledWith('/api/v1/git/9/review', {
      description: 'PR body',
      provider: 'forgejo',
    })
  })
})
