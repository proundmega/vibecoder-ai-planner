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

function extractData(response, validator) {
  return response.json().then(data => {
    if (validator && typeof validator === 'function') {
      validator(data)
    }
    return data.data !== undefined ? data.data : data
  })
}

export function get(url, options = {}) {
  return apiFetch(url, options).then(res => extractData(res, options.validate))
}

export function post(url, body, options = {}) {
  const opts = {
    method: 'POST',
    body: JSON.stringify(body),
    ...options,
  }
  return apiFetch(url, opts).then(res => extractData(res, options.validate))
}

export function put(url, body, options = {}) {
  const opts = {
    method: 'PUT',
    body: JSON.stringify(body),
    ...options,
  }
  return apiFetch(url, opts).then(res => extractData(res, options.validate))
}

export function del(url, options = {}) {
  return apiFetch(url, { method: 'DELETE', ...options }).then(res => extractData(res, options.validate))
}

export function patch(url, body, options = {}) {
  const opts = { method: 'PATCH' }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  return apiFetch(url, opts).then(res => extractData(res, options.validate))
}

export function postWithHeaders(url, body, extraHeaders = {}, options = {}) {
  const opts = {
    method: 'POST',
    body: JSON.stringify(body),
    headers: extraHeaders,
    ...options,
  }
  return apiFetch(url, opts).then(res => extractData(res, options.validate))
}

export function postMultipart(url, formData, options = {}) {
  const authStore = useAuthStore()
  const token = authStore.token.value
  const headers = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  }).then(async (response) => {
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
    return extractData(response, options.validate)
  })
}
