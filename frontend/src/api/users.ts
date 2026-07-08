import { get, post, put, del, patch } from './client'

export interface User {
  id: string
  name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface UserListResponse {
  users: User[]
  total: number
  page: number
  perPage: number
}

export interface ListFilters {
  role?: string
  search?: string
  is_active?: boolean
  page?: number
  perPage?: number
}

export function listUsers(filters: ListFilters = {}): Promise<UserListResponse> {
  const params = new URLSearchParams()
  if (filters.role) params.append('role', filters.role)
  if (filters.search) params.append('search', filters.search)
  if (filters.page) params.append('page', String(filters.page))
  if (filters.perPage) params.append('perPage', String(filters.perPage))

  const queryString = params.toString()
  return get(`/api/v1/users${queryString ? '?' + queryString : ''}`)
}

export function listAllUsers(filters: ListFilters = {}): Promise<UserListResponse> {
  const params = new URLSearchParams()
  if (filters.role) params.append('role', filters.role)
  if (filters.search) params.append('search', filters.search)
  if (filters.is_active !== undefined) params.append('is_active', String(filters.is_active))
  if (filters.page) params.append('page', String(filters.page))
  if (filters.perPage) params.append('perPage', String(filters.perPage))

  const queryString = params.toString()
  return get<UserListResponse>(`/api/v1/users/super-admin${queryString ? '?' + queryString : ''}`)
}

export function createUser(data: { name: string; email: string; password: string; role: string }): Promise<User> {
  return post('/api/v1/users', data)
}

export function updateUser(id: string, data: Partial<User>): Promise<User> {
  return put(`/api/v1/users/${id}`, data)
}

export function toggleUserActive(id: string): Promise<User> {
  return patch<User>(`/api/v1/users/${id}/toggle-active`, undefined)
}

export function deleteUser(id: string): Promise<void> {
  return del(`/api/v1/users/${id}`)
}
