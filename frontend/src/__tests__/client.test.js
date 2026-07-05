import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as client from '../api/client'

global.fetch = vi.fn()
vi.mock('../router', () => ({
  default: {
    push: vi.fn(),
    currentRoute: { value: { fullPath: '/test' } },
  },
}))

const mockAuthStore = {
  token: { value: 'test-token' },
  logout: vi.fn(),
}

vi.mock('../stores/auth', () => ({
  useAuthStore: () => mockAuthStore,
}))

describe('client API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockAuthStore.token.value = 'test-token'
    mockAuthStore.logout.mockReset()
  })

  describe('get', () => {
    it('sends GET request with correct URL', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.get('/api/test')

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
      })
    })

    it('passes custom headers', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.get('/api/test', {
        headers: { 'X-API-Key': 'key-123' },
      })

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
          'X-API-Key': 'key-123',
        },
      })
    })

    it('returns extracted data from response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1, name: 'test' } }),
      })

      const result = await client.get('/api/test')

      expect(result).toEqual({ id: 1, name: 'test' })
    })

    it('returns data directly when no data wrapper', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 1, name: 'test' }),
      })

      const result = await client.get('/api/test')

      expect(result).toEqual({ id: 1, name: 'test' })
    })

    it('throws on fetch error', async () => {
      global.fetch.mockRejectedValue(new Error('Network error'))

      await expect(client.get('/api/test')).rejects.toThrow('Network error')
    })
  })

  describe('post', () => {
    it('sends POST request with body', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.post('/api/test', { name: 'test' })

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'test' }),
      })
    })

    it('returns extracted data', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1, created: true } }),
      })

      const result = await client.post('/api/test', { name: 'test' })

      expect(result).toEqual({ id: 1, created: true })
    })
  })

  describe('put', () => {
    it('sends PUT request with body', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.put('/api/test/1', { name: 'updated' })

      expect(global.fetch).toHaveBeenCalledWith('/api/test/1', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'updated' }),
      })
    })
  })

  describe('patch', () => {
    it('sends PATCH request with body', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.patch('/api/test/1', { name: 'patched' })

      expect(global.fetch).toHaveBeenCalledWith('/api/test/1', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
        body: JSON.stringify({ name: 'patched' }),
      })
    })
  })

  describe('del', () => {
    it('sends DELETE request', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { deleted: true } }),
      })

      await client.del('/api/test/1')

      expect(global.fetch).toHaveBeenCalledWith('/api/test/1', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
        },
      })
    })

    it('returns extracted data', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { deleted: true } }),
      })

      const result = await client.del('/api/test/1')

      expect(result).toEqual({ deleted: true })
    })
  })

  describe('postWithHeaders', () => {
    it('sends POST with extra headers merged with defaults', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.postWithHeaders('/api/test', { name: 'test' }, { 'X-API-Key': 'agent-key' })

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-token',
          'X-API-Key': 'agent-key',
        },
        body: JSON.stringify({ name: 'test' }),
      })
    })
  })

  describe('401 handling', () => {
    it('calls logout and redirects on 401', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({}),
      })

      await expect(client.get('/api/test')).rejects.toThrow('Unauthorized')
      expect(mockAuthStore.logout).toHaveBeenCalled()
    })

    it('does not add Authorization header when no token', async () => {
      mockAuthStore.token.value = ''

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ data: { id: 1 } }),
      })

      await client.get('/api/test')

      expect(global.fetch).toHaveBeenCalledWith('/api/test', {
        headers: {
          'Content-Type': 'application/json',
        },
      })
    })
  })

  describe('validator integration', () => {
    it('calls validator function when validate option is provided', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      })

      await client.get('/api/test', { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { id: 1 } })
    })

    it('does not call validator when validate option is not provided', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      })

      await client.get('/api/test')

      expect(mockValidator).not.toHaveBeenCalled()
    })

    it('throws when validator throws on bad response', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      })

      const badValidator = () => { throw new Error('Validation failed') }

      await expect(client.get('/api/test', { validate: badValidator })).rejects.toThrow('Validation failed')
    })

    it('validator is called with extracted data for post', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 2, created: true } }),
      })

      await client.post('/api/test', { name: 'test' }, { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { id: 2, created: true } })
    })

    it('validator is called with extracted data for put', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1, updated: true } }),
      })

      await client.put('/api/test/1', { name: 'updated' }, { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { id: 1, updated: true } })
    })

    it('validator is called with extracted data for patch', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      })

      await client.patch('/api/test/1', { name: 'patched' }, { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { id: 1 } })
    })

    it('validator is called with extracted data for del', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { deleted: true } }),
      })

      await client.del('/api/test/1', { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { deleted: true } })
    })

    it('validator is called with extracted data for postWithHeaders', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      })

      await client.postWithHeaders('/api/test', { name: 'test' }, { 'X-API-Key': 'key' }, { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { id: 1 } })
    })

    it('validator is called with extracted data for postMultipart', async () => {
      const mockValidator = vi.fn()
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1, filename: 'test.txt' } }),
      })

      const formData = new FormData()
      await client.postMultipart('/api/test/upload', formData, { validate: mockValidator })

      expect(mockValidator).toHaveBeenCalledWith({ success: true, data: { id: 1, filename: 'test.txt' } })
    })

    it('validator can check response shape before data extraction', async () => {
      const strictValidator = (data) => {
        if (!data.success) throw new Error('success must be true')
        if (!data.data) throw new Error('data must be present')
      }
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { id: 1 } }),
      })

      await expect(client.get('/api/test', { validate: strictValidator })).resolves.toEqual({ id: 1 })
    })

    it('validator rejects missing data field', async () => {
      const strictValidator = (data) => {
        if (!data.data) throw new Error('data must be present')
      }
      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      await expect(client.get('/api/test', { validate: strictValidator })).rejects.toThrow('data must be present')
    })
  })
})
