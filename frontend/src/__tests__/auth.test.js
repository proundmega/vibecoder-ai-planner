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
        status: 201,
        json: () => Promise.resolve({ token: 'abc', user: { id: 1, name: 'Test', email: 'test@example.com', role: 'user', isActive: true } }),
      })

      await registerUser('Test', 'test@example.com', 'password123')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Test', email: 'test@example.com', password: 'password123' }),
      })
    })

    it('extracts token and user from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 201,
        json: () => Promise.resolve({ token: 'abc', user: { id: 1, name: 'Test', email: 'test@example.com', role: 'user', isActive: true } }),
      })

      const result = await registerUser('Test', 'test@example.com', 'password123')

      expect(result.token).toBe('abc')
      expect(result.user.id).toBe(1)
      expect(result.user.name).toBe('Test')
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

    it('throws RATE_LIMITED error on 429 response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ retryAfter: 60, retryAt: '2025-01-01T00:00:00.000Z' }),
      })

      await expect(registerUser('Test', 'test@example.com', 'password123')).rejects.toThrow('Too many requests')
    })

    it('throws validation error on malformed response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ notSuccess: true, notData: { token: 'abc' } }),
      })

      await expect(registerUser('Test', 'test@example.com', 'password123')).rejects.toThrow('Response validation failed')
    })
  })

  describe('loginUser', () => {
    it('sends POST request with correct data', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: 'xyz', user: { id: 2, name: 'Test', email: 'test@example.com', role: 'admin', isActive: true } }),
      })

      await loginUser('login@example.com', 'password123')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'login@example.com', password: 'password123' }),
      })
    })

    it('extracts token and user from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ token: 'xyz', user: { id: 2, name: 'Test', email: 'test@example.com', role: 'admin', isActive: true } }),
      })

      const result = await loginUser('login@example.com', 'password123')

      expect(result.token).toBe('xyz')
      expect(result.user.id).toBe(2)
      expect(result.user.role).toBe('admin')
    })

    it('returns lockout object on 423 response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 423,
        json: () => Promise.resolve({ error: { code: 'LOCKED', message: 'Account locked', lockedUntil: '2025-01-01T01:00:00.000Z', retryAfter: 900 } }),
      })

      const result = await loginUser('login@example.com', 'wrongpassword')

      expect('lockout' in result).toBe(true)
      expect(result.lockout.lockedUntil).toBe('2025-01-01T01:00:00.000Z')
      expect(result.lockout.retryAfter).toBe(900)
    })

    it('throws on 401 response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: 'Invalid credentials' }),
      })

      await expect(loginUser('login@example.com', 'wrongpassword')).rejects.toThrow('Invalid credentials')
    })

    it('throws RATE_LIMITED error on 429 response', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: () => Promise.resolve({ retryAfter: 60, retryAt: '2025-01-01T00:00:00.000Z' }),
      })

      await expect(loginUser('login@example.com', 'password123')).rejects.toThrow('Too many requests')
    })

    it('throws validation error on malformed response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ notToken: 'xyz', notUser: {} }),
      })

      await expect(loginUser('login@example.com', 'password123')).rejects.toThrow('Response validation failed')
    })
  })

  describe('getCurrentUser', () => {
    it('sends GET request with Authorization header', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 1, name: 'Test', email: 'test@example.com', role: 'admin', isActive: true } }),
      })

      await getCurrentUser('test-token')

      expect(global.fetch).toHaveBeenCalledWith('/api/auth/me', {
        headers: { 'Authorization': 'Bearer test-token' },
      })
    })

    it('returns user object from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: { id: 1, name: 'Test', email: 'test@example.com', role: 'admin', isActive: true } }),
      })

      const result = await getCurrentUser('test-token')

      expect(result.id).toBe(1)
      expect(result.name).toBe('Test')
      expect(result.role).toBe('admin')
    })

    it('returns null when user is missing', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      })

      const result = await getCurrentUser('test-token')

      expect(result).toBeNull()
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
