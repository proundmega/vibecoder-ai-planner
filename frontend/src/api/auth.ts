import { User } from '../stores/auth'

interface AuthData {
  token: string
  user: User
}

function validateAuthResponse(data: unknown): string[] {
  const errors: string[] = []
  if (typeof data !== 'object' || data === null) {
    errors.push('root: response must be an object')
    return errors
  }
  const obj = data as Record<string, unknown>
  if (!('token' in obj) || typeof obj.token !== 'string') {
    errors.push('root.token: required string field missing')
  }
  if (!('user' in obj) || typeof obj.user !== 'object' || obj.user === null) {
    errors.push('root.user: required object field missing')
  }
  return errors
}

export async function registerUser(name: string, email: string, password: string): Promise<AuthData> {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })

  if (response.status === 429) {
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    const retryAfter = parseInt((body as Record<string, unknown>)?.retryAfter as string || '60', 10)
    const retryAt = (body as Record<string, unknown>)?.retryAt as string || ''
    const error = new Error('Too many requests. Please try again later.')
    Object.defineProperty(error, 'error', { value: { code: 'RATE_LIMITED', retryAfter, retryAt }, writable: false })
    throw error
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    let message: string | null = null
    if (typeof body?.error === 'string') message = body.error
    else if (typeof body?.error?.message === 'string') message = body.error.message
    else if (typeof body?.message === 'string') message = body.message
    throw new Error(message || 'Registration failed')
  }

  const data = await response.json()

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid response format')
  }

  const validationErrors = validateAuthResponse(data)
  if (validationErrors.length > 0) {
    throw new Error(`Response validation failed: ${validationErrors.join('; ')}`)
  }

  return data as AuthData
}

export interface LockoutError {
  code: string
  message: string
  lockedUntil: string
  retryAfter: number
}

export async function loginUser(email: string, password: string): Promise<AuthData | { lockout: LockoutError }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })

  if (response.status === 429) {
    const body = await response.json().catch(() => ({} as Record<string, unknown>))
    const retryAfter = parseInt((body as Record<string, unknown>)?.retryAfter as string || '60', 10)
    const retryAt = (body as Record<string, unknown>)?.retryAt as string || ''
    const error = new Error('Too many requests. Please try again later.')
    Object.defineProperty(error, 'error', { value: { code: 'RATE_LIMITED', retryAfter, retryAt }, writable: false })
    throw error
  }

  if (response.status === 423) {
    const body = await response.json().catch(() => null)
    const lockout = body?.error as LockoutError | undefined
    if (lockout) {
      return { lockout }
    }
    throw new Error('Account locked')
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    let message: string | null = null
    if (typeof body?.error === 'string') message = body.error
    else if (typeof body?.error?.message === 'string') message = body.error.message
    else if (typeof body?.message === 'string') message = body.message
    throw new Error(message || 'Login failed')
  }

  const data = await response.json()

  if (typeof data !== 'object' || data === null) {
    throw new Error('Invalid response format')
  }

  const validationErrors = validateAuthResponse(data)
  if (validationErrors.length > 0) {
    throw new Error(`Response validation failed: ${validationErrors.join('; ')}`)
  }

  return data as AuthData
}

export async function getCurrentUser(token: string): Promise<User | null> {
  const response = await fetch('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error('Not authenticated')
  }
  const data = await response.json()
  return (data.user as User) || null
}
