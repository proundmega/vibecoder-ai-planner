import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useGitHub } from '@/composables/useGitHub'

const mockGetRepoStatus = vi.fn()
const mockConnectRepo = vi.fn()
const mockDisconnectRepo = vi.fn()
const mockListBranches = vi.fn()
const mockListPRs = vi.fn()
const mockCreateBranch = vi.fn()

vi.mock('@/api/github', () => ({
  getRepoStatus: (...args: unknown[]) => mockGetRepoStatus(...args),
  connectRepo: (...args: unknown[]) => mockConnectRepo(...args),
  disconnectRepo: (...args: unknown[]) => mockDisconnectRepo(...args),
  listBranches: (...args: unknown[]) => mockListBranches(...args),
  listPRs: (...args: unknown[]) => mockListPRs(...args),
  createBranch: (...args: unknown[]) => mockCreateBranch(...args),
}))

describe('useGitHub', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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

  it('load sets repo when connected', async () => {
    const github = useGitHub(1)
    mockGetRepoStatus.mockResolvedValue({
      connected: true,
      repo_url: 'a/b',
      default_branch: 'main',
    })
    mockListBranches.mockResolvedValue([{ name: 'main', is_default: true }])
    mockListPRs.mockResolvedValue([])

    await github.load()
    expect(github.loading.value).toBe(false)
    expect(github.repo.value).toEqual({ connected: true, repo_url: 'a/b', default_branch: 'main' })
    expect(github.branches.value).toEqual([{ name: 'main', is_default: true }])
    expect(github.error.value).toBeNull()
  })

  it('load sets error on failure', async () => {
    const github = useGitHub(1)
    mockGetRepoStatus.mockRejectedValue(new Error('fail'))

    await github.load()
    expect(github.loading.value).toBe(false)
    expect(github.error.value).toBe('Failed to load GitHub status')
  })

  it('connect calls connectRepo and reloads', async () => {
    const github = useGitHub(1)
    github.repoUrl.value = 'https://example.com'
    mockGetRepoStatus.mockResolvedValue({ connected: true })
    mockListBranches.mockResolvedValue([])
    mockListPRs.mockResolvedValue([])

    await github.connect()
    expect(mockConnectRepo).toHaveBeenCalledWith('1', 'https://example.com', '')
    expect(github.showConnectForm.value).toBe(false)
  })

  it('disconnect clears state', async () => {
    const github = useGitHub(1)
    mockDisconnectRepo.mockResolvedValue(undefined)

    await github.disconnect()
    expect(github.repo.value).toBeNull()
    expect(github.branches.value).toEqual([])
    expect(github.prs.value).toEqual([])
  })

  it('createBranch calls createBranch API and reloads branches', async () => {
    const github = useGitHub(1)
    mockListBranches.mockResolvedValue([])
    github.branchTicketId.value = 't-1'

    await github.createBranch('t-1')
    expect(mockCreateBranch).toHaveBeenCalledWith('t-1', 'ticket-t-1', '1')
    expect(github.branchTicketId.value).toBe('')
  })
})
