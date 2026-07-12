import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loginUser } from '../api/auth'

describe('loginUser - Lockout handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns lockout object when API returns 423', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 423,
      ok: false,
      json: () => Promise.resolve({
        error: {
          code: 'ACCOUNT_LOCKED',
          message: 'Account locked. Try again in 14m 30s.',
          lockedUntil: '2025-07-12T15:00:00.000Z',
          retryAfter: 870,
        }
      }),
    })

    const result = await loginUser('test@example.com', 'wrongpassword')

    if ('lockout' in result) {
      expect(result.lockout.code).toBe('ACCOUNT_LOCKED')
      expect(result.lockout.retryAfter).toBe(870)
      expect(result.lockout.lockedUntil).toBe('2025-07-12T15:00:00.000Z')
    } else {
      throw new Error('Expected lockout response')
    }
  })

  it('throws generic error on 423 without error body', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 423,
      ok: false,
      json: () => Promise.reject(new Error('Parse error')),
    })

    await expect(loginUser('test@example.com', 'wrongpassword')).rejects.toThrow('Account locked')
  })

  it('returns normal result on successful login', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: () => Promise.resolve({ token: 'abc123', user: { id: 1, email: 'test@example.com' } }),
    })

    const result = await loginUser('test@example.com', 'correctpassword')

    if ('lockout' in result) {
      throw new Error('Expected normal login response')
    }
    expect(result.token).toBe('abc123')
  })

  it('throws on 401 for wrong password', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: () => Promise.resolve({ error: 'Invalid credentials' }),
    })

    await expect(loginUser('test@example.com', 'wrong')).rejects.toThrow('Invalid credentials')
  })
})
