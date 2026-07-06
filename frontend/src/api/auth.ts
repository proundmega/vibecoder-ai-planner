import { User } from '../stores/auth'

interface AuthResponse {
  success?: boolean
  data?: {
    token: string
    user: User
  }
  error?: string | { message?: string }
  message?: string
  user?: User
}

function extractErrorMessage(body: AuthResponse | null): string | null {
  if (typeof body?.error === 'string') return body.error
  if (typeof body?.error?.message === 'string') return body.error.message
  if (typeof body?.message === 'string') return body.message
  return null
}

export async function registerUser(name: string, email: string, password: string): Promise<{ token: string; user: User }> {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = extractErrorMessage(body) || 'Registration failed'
    throw new Error(message)
  }
  const data = await response.json()
  return (data.success ? data.data : data) as { token: string; user: User }
}

export async function loginUser(email: string, password: string): Promise<{ token: string; user: User }> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const message = extractErrorMessage(body) || 'Login failed'
    throw new Error(message)
  }
  const data = await response.json()
  return (data.success ? data.data : data) as { token: string; user: User }
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
