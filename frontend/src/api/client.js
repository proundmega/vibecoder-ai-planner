import router from '../router'
import { useAuthStore } from '../stores/auth'

function apiFetch(url, options = {}) {
  const authStore = useAuthStore()
  const token = authStore.token.value

  const headers = {
    'Content-Type': 'application/json',
    ...options.headers,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, { ...options, headers })
    .then(async (response) => {
      if (response.status === 401) {
        authStore.logout()
        router.push({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
        const err = new Error('Unauthorized')
        err.status = 401
        throw err
      }
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        try {
          const body = await response.json()
          message = body?.error?.message || body?.message || message
        } catch {}
        const err = new Error(message)
        err.status = response.status
        throw err
      }
      return response
    })
}

function extractData(response) {
  return response.json().then(data => data.data !== undefined ? data.data : data)
}

export function get(url, options = {}) {
  return apiFetch(url, options).then(extractData)
}

export function post(url, body) {
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(extractData)
}

export function put(url, body) {
  return apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  }).then(extractData)
}

export function del(url) {
  return apiFetch(url, { method: 'DELETE' }).then(extractData)
}

export function patch(url, body) {
  const opts = { method: 'PATCH' }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  return apiFetch(url, opts).then(extractData)
}

export function postWithHeaders(url, body, extraHeaders = {}) {
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: extraHeaders,
  }).then(extractData)
}
