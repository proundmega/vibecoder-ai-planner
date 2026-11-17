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
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ connected: true, branch: 'main' })

      const result = await github.getRepoStatus('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/github/proj-123/repo')
      expect(result).toEqual({ connected: true, branch: 'main' })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await github.getRepoStatus('proj-123')

      expect(result).toBeNull()
    })
  })

  describe('connectRepo', () => {
    it('sends POST request with repoUrl and accessToken', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ connected: true, repo: 'org/repo' })

      const result = await github.connectRepo('proj-123', 'https://github.com/org/repo', 'ghp_testtoken123')

      expect(post).toHaveBeenCalledWith('/api/v1/github/proj-123/repo/connect', {
        repoUrl: 'https://github.com/org/repo',
        accessToken: 'ghp_testtoken123',
      })
      expect(result).toEqual({ connected: true, repo: 'org/repo' })
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
    it('sends POST request with branchName', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ name: 'feature/fix-bug' })

      const result = await github.createBranch('ticket-1', 'feature/fix-bug')

      expect(post).toHaveBeenCalledWith('/api/v1/github/ticket-1/branch', {
        branchName: 'feature/fix-bug',
      })
      expect(result).toEqual({ name: 'feature/fix-bug' })
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
      post.mockResolvedValue({ id: 'pr-1', url: 'https://github.com/pr/1' })

      const result = await github.createPR('ticket-1', 'my description')

      expect(post).toHaveBeenCalledWith('/api/v1/github/ticket-1/pr', {
        description: 'my description',
        projectId: undefined,
      })
      expect(result).toEqual({ id: 'pr-1', url: 'https://github.com/pr/1' })
    })

    it('[R3] createPR posts { description } (not { title, body, branchName })', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 1 })

      await github.createPR('t1', 'my description')

      expect(post).toHaveBeenCalledWith('/api/v1/github/t1/pr', { description: 'my description', projectId: undefined })
    })
  })
})
