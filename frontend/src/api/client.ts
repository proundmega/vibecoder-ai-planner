import router from '../router'
import { useAuthStore } from '../stores/auth'

interface ApiOptions extends RequestInit {
  validate?: (data: unknown) => void
}

interface ExtendedError extends Error {
  status?: number
}

function apiFetch(url: string, options: ApiOptions = {}): Promise<Response> {
  const authStore = useAuthStore()
  const token = authStore.token.value

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...options.headers as Record<string, string>,
  }

  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  return fetch(url, { ...options, headers })
    .then(async (response: Response) => {
      if (response.status === 401) {
        authStore.logout()
        router.push({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
        const err = new Error('Unauthorized') as ExtendedError
        err.status = 401
        throw err
      }
      if (!response.ok) {
        let message = `HTTP ${response.status}`
        try {
          const body = await response.json()
          message = (body?.error?.message as string) || (body?.message as string) || message
        } catch {
          // Ignore JSON parse errors
        }
        const err = new Error(message) as ExtendedError
        err.status = response.status
        throw err
      }
      return response
    })
}

function extractData<T>(response: Response, validator?: (data: unknown) => void): Promise<T> {
  return response.json().then((data: T) => {
    if (validator && typeof validator === 'function') {
      validator(data)
    }
    return (data as { data?: T }).data !== undefined ? (data as { data?: T }).data! : data
  })
}

export function get<T = unknown>(url: string, options: ApiOptions = {}): Promise<T> {
  return apiFetch(url, options).then((res: Response) => extractData<T>(res, options.validate))
}

export function post<T = unknown>(url: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const opts: ApiOptions = {
    method: 'POST',
    body: JSON.stringify(body),
    ...options,
  }
  return apiFetch(url, opts).then((res: Response) => extractData<T>(res, options.validate))
}

export function put<T = unknown>(url: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const opts: ApiOptions = {
    method: 'PUT',
    body: JSON.stringify(body),
    ...options,
  }
  return apiFetch(url, opts).then((res: Response) => extractData<T>(res, options.validate))
}

export function del<T = unknown>(url: string, options: ApiOptions = {}): Promise<T> {
  return apiFetch(url, { method: 'DELETE', ...options }).then((res: Response) => extractData<T>(res, options.validate))
}

export function patch<T = unknown>(url: string, body: unknown, options: ApiOptions = {}): Promise<T> {
  const opts: ApiOptions = { method: 'PATCH' }
  if (body !== undefined) {
    opts.body = JSON.stringify(body)
  }
  return apiFetch(url, opts).then((res: Response) => extractData<T>(res, options.validate))
}

export function postWithHeaders<T = unknown>(url: string, body: unknown, extraHeaders: Record<string, string> = {}, options: ApiOptions = {}): Promise<T> {
  const { validate, ...rest } = options
  const opts: ApiOptions = {
    method: 'POST',
    body: JSON.stringify(body),
    ...rest,
    headers: { ...extraHeaders, ...(rest.headers as Record<string, string> || {}) },
  }
  return apiFetch(url, opts).then((res: Response) => extractData<T>(res, validate))
}

export function postMultipart<T = unknown>(url: string, formData: FormData, options: ApiOptions = {}): Promise<T> {
  const authStore = useAuthStore()
  const token = authStore.token.value
  const headers: Record<string, string> = {}
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }
  return fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  }).then(async (response: Response) => {
    if (response.status === 401) {
      authStore.logout()
      router.push({ name: 'Login', query: { redirect: router.currentRoute.value.fullPath } })
      const err = new Error('Unauthorized') as ExtendedError
      err.status = 401
      throw err
    }
    if (!response.ok) {
      let message = `HTTP ${response.status}`
      try {
        const body = await response.json()
        message = (body?.error?.message as string) || (body?.message as string) || message
      } catch {
        // Ignore JSON parse errors
      }
      const err = new Error(message) as ExtendedError
      err.status = response.status
      throw err
    }
    return extractData<T>(response, options.validate)
  })
}
