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
    it('sends POST request with repoUrl and branch', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ connected: true, repo: 'org/repo' })

      const result = await github.connectRepo('proj-123', 'https://github.com/org/repo', 'main')

      expect(post).toHaveBeenCalledWith('/api/v1/github/proj-123/repo/connect', {
        repoUrl: 'https://github.com/org/repo',
        branch: 'main',
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
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ name: 'main' }, { name: 'develop' }])

      const result = await github.listBranches('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/github/proj-123/branches')
      expect(result).toEqual([{ name: 'main' }, { name: 'develop' }])
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
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'pr-1', title: 'Fix bug' }])

      const result = await github.listPRs('proj-123')

      expect(get).toHaveBeenCalledWith('/api/v1/github/proj-123/prs')
      expect(result).toEqual([{ id: 'pr-1', title: 'Fix bug' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await github.listPRs('proj-123')

      expect(result).toEqual([])
    })
  })

  describe('createPR', () => {
    it('sends POST request with title, body, and branchName', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'pr-1', url: 'https://github.com/pr/1' })

      const result = await github.createPR('ticket-1', 'Fix bug', 'Fixed the bug', 'feature/fix-bug')

      expect(post).toHaveBeenCalledWith('/api/v1/github/ticket-1/pr', {
        title: 'Fix bug',
        body: 'Fixed the bug',
        branchName: 'feature/fix-bug',
      })
      expect(result).toEqual({ id: 'pr-1', url: 'https://github.com/pr/1' })
    })
  })
})
