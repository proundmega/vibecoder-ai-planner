import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as github from '../api/github'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  del: vi.fn(),
}))

describe('github API', () => {
  beforeEach(() => vi.clearAllMocks())

  describe('getRepoStatus', () => {
    it('normalizes the backend repo row into the UI contract', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({
        id: 3,
        projectId: 42,
        repoUrl: 'org/repo',
        defaultBranch: 'main',
        isActive: true,
      })

      const result = await github.getRepoStatus('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/github/proj-123/repo')
      expect(result).toEqual({
        id: 3,
        projectId: '42',
        repoUrl: 'org/repo',
        defaultBranch: 'main',
        isActive: true,
        connected: true,
      })
    })

    it('derives disconnected from an inactive repo row', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ repoUrl: 'org/repo', defaultBranch: 'main', isActive: false })

      const result = await github.getRepoStatus('proj-123')

      expect(result?.connected).toBe(false)
    })

    it('accepts the legacy snake_case shape', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ repo_url: 'org/repo', default_branch: 'main', connected: true })

      const result = await github.getRepoStatus('proj-123')

      expect(result?.repoUrl).toBe('org/repo')
      expect(result?.defaultBranch).toBe('main')
      expect(result?.connected).toBe(true)
    })

    it('treats a legacy row without flags as connected when a repo URL exists', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ repo_url: 'org/repo', default_branch: 'main' })

      const result = await github.getRepoStatus('proj-123')

      expect(result?.isActive).toBe(true)
      expect(result?.connected).toBe(true)
    })

    it('returns null when the backend has no repo', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue(null)

      const result = await github.getRepoStatus('proj-123')

      expect(result).toBeNull()
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await github.getRepoStatus('proj-123')

      expect(result).toBeNull()
    })
  })

  describe('connectRepo', () => {
    it('sends POST request and normalizes the connected repo', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({
        id: 3,
        projectId: 42,
        repoUrl: 'org/repo',
        defaultBranch: 'main',
        isActive: true,
      })

      const result = await github.connectRepo('proj-123', 'https://github.com/org/repo', 'ghp_testtoken123')

      expect(post).toHaveBeenCalledWith('/api/v1/github/proj-123/repo/connect', {
        repoUrl: 'https://github.com/org/repo',
        accessToken: 'ghp_testtoken123',
      })
      expect(result?.repoUrl).toBe('org/repo')
      expect(result?.defaultBranch).toBe('main')
      expect(result?.connected).toBe(true)
    })
  })

  describe('disconnectRepo', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ disconnected: true })

      const result = await github.disconnectRepo('proj-123')

      expect(del).toHaveBeenCalledWith('/api/v1/github/proj-123/repo')
      expect(result).toEqual({ disconnected: true })
    })
  })

  describe('listBranches', () => {
    it('normalizes backend branch names and extracts ticket ids', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([
        'vibecode/ticket-42-fix-login',
        'vibecode/ticket-7',
        'feature/other',
      ])

      const result = await github.listBranches('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/github/proj-123/branches')
      expect(result).toEqual([
        { name: 'vibecode/ticket-42-fix-login', ticketId: '42' },
        { name: 'vibecode/ticket-7', ticketId: '7' },
        { name: 'feature/other', ticketId: null },
      ])
    })

    it('also accepts object rows', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ name: 'vibecode/ticket-9-fix' }])

      const result = await github.listBranches('proj-123')

      expect(result).toEqual([{ name: 'vibecode/ticket-9-fix', ticketId: '9' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await github.listBranches('proj-123')

      expect(result).toEqual([])
    })
  })

  describe('createBranch', () => {
    it('sends POST request with branchName and returns the backend shape', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ branchName: 'ticket-1', ticketId: '1' })

      const result = await github.createBranch('ticket-1', 'ticket-1')

      expect(post).toHaveBeenCalledWith('/api/v1/github/ticket-1/branch', {
        branchName: 'ticket-1',
      })
      expect(result).toEqual({ branchName: 'ticket-1', ticketId: '1' })
    })
  })

  describe('deleteBranch', () => {
    it('sends DELETE request to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await github.deleteBranch('ticket-1')

      expect(del).toHaveBeenCalledWith('/api/v1/github/ticket-1/branch')
      expect(result).toEqual({ deleted: true })
    })
  })

  describe('listPRs', () => {
    it('normalizes the backend pull request shape', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{
        id: 1,
        number: 7,
        title: 'Fix bug',
        state: 'open',
        url: 'https://github.com/org/repo/pull/7',
        head: 'vibecode/ticket-1-fix',
        base: 'main',
      }])

      const result = await github.listPRs('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/github/proj-123/prs')
      expect(result).toEqual([{
        id: 1,
        number: 7,
        title: 'Fix bug',
        state: 'open',
        url: 'https://github.com/org/repo/pull/7',
        head: 'vibecode/ticket-1-fix',
        base: 'main',
      }])
    })

    it('accepts nested head/base shapes', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{
        id: 2,
        title: 'Nested',
        state: 'closed',
        html_url: 'https://github.com/org/repo/pull/8',
        head: { ref: 'vibecode/ticket-2-fix' },
        base: { ref: 'main' },
      }])

      const result = await github.listPRs('proj-123')

      expect(result[0]).toMatchObject({
        url: 'https://github.com/org/repo/pull/8',
        head: 'vibecode/ticket-2-fix',
        base: 'main',
      })
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await github.listPRs('proj-123')

      expect(result).toEqual([])
    })
  })

  describe('createPR', () => {
    it('sends POST request with description and projectId', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({
        id: 1,
        number: 7,
        state: 'open',
        url: 'https://github.com/org/repo/pull/7',
        head: 'ticket-1',
        base: 'main',
      })

      const result = await github.createPR('ticket-1', 'my description')

      expect(post).toHaveBeenCalledWith('/api/v1/github/ticket-1/pr', {
        description: 'my description',
        projectId: undefined,
      })
      expect(result).toEqual({
        id: 1,
        number: 7,
        state: 'open',
        url: 'https://github.com/org/repo/pull/7',
        head: 'ticket-1',
        base: 'main',
      })
    })

    it('[R3] createPR posts { description } (not { title, body, branchName })', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 1 })

      await github.createPR('t1', 'my description')

      expect(post).toHaveBeenCalledWith('/api/v1/github/t1/pr', { description: 'my description', projectId: undefined })
    })
  })
})
