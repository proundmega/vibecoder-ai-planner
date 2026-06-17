import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as projects from '../api/projects'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}))

describe('projects API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchProjects', () => {
    it('sends GET request to correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'p1', name: 'Project 1' }])

      const result = await projects.fetchProjects()

      expect(get).toHaveBeenCalledWith('/api/v1/projects')
      expect(result).toEqual([{ id: 'p1', name: 'Project 1' }])
    })

    it('returns empty array on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Network error'))

      const result = await projects.fetchProjects()

      expect(result).toEqual([])
    })
  })

  describe('createProject', () => {
    it('sends POST request with name and description', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'p1', name: 'New Project', description: 'A test project' })

      const result = await projects.createProject('New Project', 'A test project')

      expect(post).toHaveBeenCalledWith('/api/v1/projects', {
        name: 'New Project',
        description: 'A test project',
      })
      expect(result).toEqual({ id: 'p1', name: 'New Project', description: 'A test project' })
    })

    it('sends POST with empty description', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'p1', name: 'New Project' })

      const result = await projects.createProject('New Project', '')

      expect(post).toHaveBeenCalledWith('/api/v1/projects', {
        name: 'New Project',
        description: '',
      })
      expect(result).toEqual({ id: 'p1', name: 'New Project' })
    })

    it('returns result on success', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'p1', name: 'Created' })

      const result = await projects.createProject('Created', '')

      expect(result.id).toBe('p1')
    })
  })

  describe('fetchProjectById', () => {
    it('sends GET request with correct URL', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue({ id: 'p1', name: 'Project 1', description: 'Desc' })

      const result = await projects.fetchProjectById('p1')

      expect(get).toHaveBeenCalledWith('/api/v1/projects/p1')
      expect(result).toEqual({ id: 'p1', name: 'Project 1', description: 'Desc' })
    })

    it('returns null on error', async () => {
      const { get } = await import('../api/client')
      get.mockRejectedValue(new Error('Not found'))

      const result = await projects.fetchProjectById('nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('updateProject', () => {
    it('sends PUT request with updated data', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue({ id: 'p1', name: 'Updated', description: 'New desc' })

      const result = await projects.updateProject('p1', 'Updated', 'New desc')

      expect(put).toHaveBeenCalledWith('/api/v1/projects/p1', {
        name: 'Updated',
        description: 'New desc',
      })
      expect(result).toEqual({ id: 'p1', name: 'Updated', description: 'New desc' })
    })

    it('returns null on error', async () => {
      const { put } = await import('../api/client')
      put.mockRejectedValue(new Error('Update failed'))

      const result = await projects.updateProject('p1', 'Updated', 'New desc')

      expect(result).toBeNull()
    })
  })

  describe('deleteProject', () => {
    it('sends DELETE request with correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await projects.deleteProject('p1')

      expect(del).toHaveBeenCalledWith('/api/v1/projects/p1')
      expect(result).toEqual({ deleted: true })
    })

    it('returns error object on failure', async () => {
      const { del } = await import('../api/client')
      del.mockRejectedValue(new Error('Delete failed'))

      const result = await projects.deleteProject('p1')

      expect(result).toEqual({ error: 'Failed to delete' })
    })
  })
})
