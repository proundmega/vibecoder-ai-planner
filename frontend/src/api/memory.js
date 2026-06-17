import { get, post, put, del } from './client'

export function getProjectMemory(projectId) {
  return get(`/api/v1/memory/project/${projectId}`).catch(() => [])
}

export function searchMemory(projectId, query) {
  return get(`/api/v1/memory/project/${projectId}/search`, { params: { q: query } }).catch(() => [])
}

export function getAgentMemory(agentId) {
  return get(`/api/v1/memory/agent/${agentId}`).catch(() => [])
}

export function getMemory(id) {
  return get(`/api/v1/memory/${id}`).catch(() => null)
}

export function addMemory(projectId, content, metadata) {
  return post(`/api/v1/memory/project/${projectId}`, { content, metadata })
}

export function updateMemory(id, updates) {
  return put(`/api/v1/memory/${id}`, updates)
}

export function deleteMemory(id) {
  return del(`/api/v1/memory/${id}`)
}
