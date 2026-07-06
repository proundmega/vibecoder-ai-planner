import { get, post, put, del } from './client'

export interface Project {
  id: string
  name: string
  description?: string
  created_at?: string
  updated_at?: string
}

export function fetchProjects(): Promise<Project[]> {
  return get<Project[]>('/api/v1/projects').catch(() => [])
}

export function createProject(name: string, description?: string): Promise<Project | null> {
  return post<Project>('/api/v1/projects', { name, description }).catch(() => null)
}

export function fetchProjectById(id: string): Promise<Project | null> {
  return get<Project>(`/api/v1/projects/${id}`).catch(() => null)
}

export function updateProject(id: string, name: string, description?: string): Promise<Project | null> {
  return put<Project>(`/api/v1/projects/${id}`, { name, description }).catch(() => null)
}

export function deleteProject(id: string): Promise<{ error?: string }> {
  return del<{ error?: string }>(`/api/v1/projects/${id}`).catch(() => ({ error: 'Failed to delete' }))
}
