import { get, post, put, del } from './client'

export function fetchProjects() {
  return get('/api/v1/projects').catch(() => [])
}

export function createProject(name, description) {
  return post('/api/v1/projects', { name, description })
}

export function fetchProjectById(id) {
  return get(`/api/v1/projects/${id}`).catch(() => null)
}

export function updateProject(id, name, description) {
  return put(`/api/v1/projects/${id}`, { name, description }).catch(() => null)
}

export function deleteProject(id) {
  return del(`/api/v1/projects/${id}`).catch(() => ({ error: 'Failed to delete' }))
}
