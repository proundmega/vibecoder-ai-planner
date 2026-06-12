import { describe, it, expect, vi, beforeEach } from 'vitest'
import { registerUser, loginUser, getCurrentUser } from '../api/auth'

global.fetch = vi.fn()

describe('auth API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('registerUser', () => {
    it('sends POST request with correct data', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { token: 'abc', user: { id: 1, name: 'Test' } } }),
      })

      await registerUser('Test', 'test@example.com', 'password123')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'password123' }),
      })
    })

    it('extracts token and user from { success, data } response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { token: 'abc', user: { id: 1, name: 'Test' } } }),
      })

      const result = await registerUser('Test', 'test@example.com', 'password123')

      expect(result.token).toBe('abc')
      expect(result.user.id).toBe(1)
      expect(result.user.name).toBe('Test')
    })

    it('returns data directly when no success wrapper', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: 'abc', user: { id: 1 } }),
      })

      const result = await registerUser('Test', 'test@example.com', 'password123')

      expect(result.token).toBe('abc')
      expect(result.user.id).toBe(1)
    })

    it('throws on 400 response with error message', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'Email already exists' }),
      })

      await expect(registerUser('Test', 'test@example.com', 'password123')).rejects.toThrow('Email already exists')
    })

    it('throws generic error when response.json fails', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      })

      await expect(registerUser('Test', 'test@example.com', 'password123')).rejects.toThrow('Registration failed')
    })
  })

  describe('loginUser', () => {
    it('sends POST request with correct data', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { token: 'xyz', user: { id: 2, role: 'admin' } } }),
      })

      await loginUser('login@example.com', 'password123')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'password123' }),
      })
    })

    it('extracts token and user from { success, data } response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { token: 'xyz', user: { id: 2, role: 'admin' } } }),
      })

      const result = await loginUser('login@example.com', 'password123')

      expect(result.token).toBe('xyz')
      expect(result.user.id).toBe(2)
      expect(result.user.role).toBe('admin')
    })

    it('returns data directly when no success wrapper', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ token: 'xyz', user: { id: 2 } }),
      })

      const result = await loginUser('login@example.com', 'password123')

      expect(result.token).toBe('xyz')
      expect(result.user.id).toBe(2)
    })

    it('throws on 401 response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      })

      await expect(loginUser('login@example.com', 'wrongpassword')).rejects.toThrow('Invalid credentials')
    })
  })

  describe('getCurrentUser', () => {
    it('sends GET request with Authorization header', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 1, name: 'Test', role: 'admin' } }),
      })

      await getCurrentUser('test-token')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/me', {
        headers: { 'Authorization': 'Bearer test-token' },
      })
    })

    it('returns user object from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 1, name: 'Test', role: 'admin' } }),
      })

      const result = await getCurrentUser('test-token')

      expect(result.id).toBe(1)
      expect(result.name).toBe('Test')
      expect(result.role).toBe('admin')
    })

    it('throws on 401 response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      })

      await expect(getCurrentUser('invalid-token')).rejects.toThrow('Not authenticated')
    })
  })
})
