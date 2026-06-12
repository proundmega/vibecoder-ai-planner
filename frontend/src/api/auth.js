export async function registerUser(name, email, password) {
  const response = await fetch('/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email, password }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Registration failed' }))
    throw new Error(error.error || error.message || 'Registration failed')
  }
  const data = await response.json()
  return data.success ? data.data : data
}

export async function loginUser(email, password) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Login failed' }))
    throw new Error(error.error || error.message || 'Login failed')
  }
  const data = await response.json()
  return data.success ? data.data : data
}

export async function getCurrentUser(token) {
  const response = await fetch('/api/auth/me', {
    headers: { 'Authorization': `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error('Not authenticated')
  }
  const data = await response.json()
  return data.user
}
