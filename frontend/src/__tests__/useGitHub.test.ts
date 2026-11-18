import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGitHub } from '@/composables/useGitHub'

vi.mock('@/api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

import { get, post, del } from '@/api/client'

const mockGet = get as ReturnType<typeof vi.fn>
const mockPost = post as ReturnType<typeof vi.fn>
const mockDel = del as ReturnType<typeof vi.fn>

// Shape returned by GitHubService._formatRepoResult.
const repoRow = {
  id: 3,
  projectId: 1,
  repoUrl: 'a/b',
  defaultBranch: 'main',
  isActive: true,
}

describe('useGitHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/repo')) return Promise.resolve(repoRow)
      if (url.endsWith('/branches')) {
        return Promise.resolve(['vibecode/ticket-1-fix'])
      }
      if (url.endsWith('/prs')) return Promise.resolve([])
      return Promise.resolve(null)
    })
    mockPost.mockResolvedValue({ branchName: 'ticket-t-1', ticketId: 't-1' })
    mockDel.mockResolvedValue(undefined)
  })

  it('initializes with default values', () => {
    const github = useGitHub(1)
    expect(github.repo.value).toBeNull()
    expect(github.loading.value).toBe(false)
    expect(github.error.value).toBeNull()
    expect(github.branches.value).toEqual([])
    expect(github.prs.value).toEqual([])
    expect(github.loaded.value).toBe(false)
  })

  it('normalizes the backend repo shape and loads branches/PRs when connected', async () => {
    const github = useGitHub(1)

    await github.load()

    expect(github.loading.value).toBe(false)
    expect(github.repo.value).toEqual({
      id: 3,
      projectId: '1',
      repoUrl: 'a/b',
      defaultBranch: 'main',
      isActive: true,
      connected: true,
    })
    expect(github.branches.value).toEqual([{ name: 'vibecode/ticket-1-fix', ticketId: '1' }])
    expect(github.error.value).toBeNull()
    expect(mockGet).toHaveBeenCalledWith('/api/v1/github/1/branches')
  })

  it('stays disconnected when the repo is inactive', async () => {
    const github = useGitHub(1)
    mockGet.mockImplementation((url: string) => {
      if (url.endsWith('/repo')) {
        return Promise.resolve({ repoUrl: 'a/b', defaultBranch: 'main', isActive: false })
      }
      return Promise.resolve([])
    })

    await github.load()

    expect(github.repo.value?.connected).toBe(false)
    expect(mockGet).not.toHaveBeenCalledWith('/api/v1/github/1/branches')
  })

  it('tolerates a failed status request without throwing', async () => {
    const github = useGitHub(1)
    mockGet.mockRejectedValue(new Error('fail'))

    await github.load()

    expect(github.loading.value).toBe(false)
    expect(github.repo.value).toBeNull()
    expect(github.error.value).toBeNull()
  })

  it('connect calls connectRepo and reloads', async () => {
    const github = useGitHub(1)
    github.repoUrl.value = 'https://example.com'

    await github.connect()

    expect(mockPost).toHaveBeenCalledWith('/api/v1/github/1/repo/connect', {
      repoUrl: 'https://example.com',
      accessToken: '',
    })
    expect(github.showConnectForm.value).toBe(false)
    expect(github.repo.value?.connected).toBe(true)
  })

  it('disconnect clears state', async () => {
    const github = useGitHub(1)
    await github.load()

    await github.disconnect()

    expect(github.repo.value).toBeNull()
    expect(github.branches.value).toEqual([])
    expect(github.prs.value).toEqual([])
  })

  it('createBranch calls createBranch API and reloads branches', async () => {
    const github = useGitHub(1)
    github.branchTicketId.value = 't-1'

    await github.createBranch('t-1')

    expect(mockPost).toHaveBeenCalledWith('/api/v1/github/t-1/branch', {
      branchName: 'ticket-t-1',
      projectId: '1',
    })
    expect(github.branchTicketId.value).toBe('')
  })
})
