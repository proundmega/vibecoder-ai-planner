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
      return response
    })
}

export function get(url) {
  return apiFetch(url).then(res => res.json())
}

export function post(url, body) {
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
  }).then(res => res.json())
}

export function put(url, body) {
  return apiFetch(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  }).then(res => res.json())
}

export function del(url) {
  return apiFetch(url, { method: 'DELETE' }).then(res => res.json())
}

export function postWithHeaders(url, body, extraHeaders = {}) {
  return apiFetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: extraHeaders,
  }).then(res => res.json())
}
