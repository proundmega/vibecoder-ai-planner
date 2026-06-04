import { get, post, put, del } from './client'

export function fetchProjects() {
  return get('/api/projects').catch(() => [])
}

export function createProject(name, description) {
  return post('/api/projects', { name, description })
}

export function fetchProjectById(id) {
  return get(`/api/projects/${id}`).catch(() => null)
}

export function updateProject(id, name, description) {
  return put(`/api/projects/${id}`, { name, description }).catch(() => null)
}

export function deleteProject(id) {
  return del(`/api/projects/${id}`).catch(() => ({ error: 'Failed to delete' }))
}
