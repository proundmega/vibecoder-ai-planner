import { get, post, put, del, patch } from './client'

export function listUsers(filters = {}) {
  const params = new URLSearchParams()
  if (filters.role) params.append('role', filters.role)
  if (filters.search) params.append('search', filters.search)
  if (filters.page) params.append('page', filters.page)
  if (filters.perPage) params.append('perPage', filters.perPage)
  
  const queryString = params.toString()
  return get(`/api/v1/users${queryString ? '?' + queryString : ''}`)
}

export function listAllUsers(filters = {}) {
  const params = new URLSearchParams()
  if (filters.role) params.append('role', filters.role)
  if (filters.search) params.append('search', filters.search)
  if (filters.is_active !== undefined) params.append('is_active', filters.is_active)
  if (filters.page) params.append('page', filters.page)
  if (filters.perPage) params.append('perPage', filters.perPage)
  
  const queryString = params.toString()
  return get(`/api/v1/users/super-admin${queryString ? '?' + queryString : ''}`)
}

export function createUser(data) {
  return post('/api/v1/users', data)
}

export function updateUser(id, data) {
  return put(`/api/v1/users/${id}`, data)
}

export function toggleUserActive(id) {
  return patch(`/api/v1/users/${id}/toggle-active`)
}

export function deleteUser(id) {
  return del(`/api/v1/users/${id}`)
}
