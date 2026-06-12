import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as users from '../api/users'

vi.mock('../api/client', () => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  patch: vi.fn(),
}))

describe('users API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listUsers', () => {
    it('sends GET without query params when no filters', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'u1', name: 'User 1' }])

      const result = await users.listUsers()

      expect(get).toHaveBeenCalledWith('/api/users')
      expect(result).toEqual([{ id: 'u1', name: 'User 1' }])
    })

    it('appends role filter to query string', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'u1', role: 'admin' }])

      await users.listUsers({ role: 'admin' })

      expect(get).toHaveBeenCalledWith('/api/users?role=admin')
    })

    it('appends search filter to query string', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'u1', name: 'John' }])

      await users.listUsers({ search: 'John' })

      expect(get).toHaveBeenCalledWith('/api/users?search=John')
    })

    it('appends pagination params', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([])

      await users.listUsers({ page: 2, perPage: 10 })

      expect(get).toHaveBeenCalledWith('/api/users?page=2&perPage=10')
    })

    it('combines multiple filters', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([])

      await users.listUsers({ role: 'admin', search: 'John', page: 1, perPage: 20 })

      expect(get).toHaveBeenCalledWith('/api/users?role=admin&search=John&page=1&perPage=20')
    })
  })

  describe('listAllUsers', () => {
    it('sends GET to super-admin endpoint without filters', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'u1', name: 'All User' }])

      const result = await users.listAllUsers()

      expect(get).toHaveBeenCalledWith('/api/users/super-admin')
      expect(result).toEqual([{ id: 'u1', name: 'All User' }])
    })

   it('appends role filter', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([{ id: 'u1', role: 'admin' }])

      await users.listUsers({ role: 'admin' })

      expect(get).toHaveBeenCalledWith('/api/users?role=admin')
    })

    it('appends is_active filter', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([])

      await users.listAllUsers({ is_active: false })

      expect(get).toHaveBeenCalledWith('/api/users/super-admin?is_active=false')
    })

    it('appends pagination params', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([])

      await users.listAllUsers({ page: 1, perPage: 50 })

      expect(get).toHaveBeenCalledWith('/api/users/super-admin?page=1&perPage=50')
    })

    it('combines all filters', async () => {
      const { get } = await import('../api/client')
      get.mockResolvedValue([])

      await users.listAllUsers({ role: 'user', search: 'test', is_active: true, page: 1, perPage: 20 })

      expect(get).toHaveBeenCalledWith('/api/users/super-admin?role=user&search=test&is_active=true&page=1&perPage=20')
    })
  })

  describe('createUser', () => {
    it('sends POST with user data', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'u1', name: 'New User', role: 'user' })

      const result = await users.createUser({ name: 'New User', email: 'new@example.com', role: 'user' })

      expect(post).toHaveBeenCalledWith('/api/users', {
        name: 'New User',
        email: 'new@example.com',
        role: 'user',
      })
      expect(result).toEqual({ id: 'u1', name: 'New User', role: 'user' })
    })

    it('passes through all data fields', async () => {
      const { post } = await import('../api/client')
      post.mockResolvedValue({ id: 'u1' })

      await users.createUser({ name: 'Test', email: 't@t.com', role: 'member', description: 'Desc' })

      expect(post).toHaveBeenCalledWith('/api/users', {
        name: 'Test',
        email: 't@t.com',
        role: 'member',
        description: 'Desc',
      })
    })
  })

  describe('updateUser', () => {
    it('sends PUT with user data', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue({ id: 'u1', name: 'Updated' })

      const result = await users.updateUser('u1', { name: 'Updated', email: 'updated@example.com' })

      expect(put).toHaveBeenCalledWith('/api/users/u1', {
        name: 'Updated',
        email: 'updated@example.com',
      })
      expect(result).toEqual({ id: 'u1', name: 'Updated' })
    })

    it('sends partial updates', async () => {
      const { put } = await import('../api/client')
      put.mockResolvedValue({ id: 'u1', role: 'admin' })

      const result = await users.updateUser('u1', { role: 'admin' })

      expect(put).toHaveBeenCalledWith('/api/users/u1', { role: 'admin' })
      expect(result).toEqual({ id: 'u1', role: 'admin' })
    })
  })

  describe('toggleUserActive', () => {
    it('sends PATCH to correct URL', async () => {
      const { patch } = await import('../api/client')
      patch.mockResolvedValue({ id: 'u1', is_active: false })

      const result = await users.toggleUserActive('u1')

      expect(patch).toHaveBeenCalledWith('/api/users/u1/toggle-active')
      expect(result).toEqual({ id: 'u1', is_active: false })
    })

    it('returns updated user data', async () => {
      const { patch } = await import('../api/client')
      patch.mockResolvedValue({ id: 'u1', is_active: true })

      const result = await users.toggleUserActive('u1')

      expect(result.is_active).toBe(true)
    })
  })

  describe('deleteUser', () => {
    it('sends DELETE to correct URL', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ deleted: true })

      const result = await users.deleteUser('u1')

      expect(del).toHaveBeenCalledWith('/api/users/u1')
      expect(result).toEqual({ deleted: true })
    })

    it('returns deleted result', async () => {
      const { del } = await import('../api/client')
      del.mockResolvedValue({ success: true })

      const result = await users.deleteUser('u1')

      expect(result.success).toBe(true)
    })
  })
})
