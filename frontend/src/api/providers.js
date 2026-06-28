import { get, post, patch, del, put } from './client'

export function listProviders(projectId) {
  return get(`/api/v1/providers/${projectId}/providers`).catch(() => [])
}

export function addProvider(projectId, name, providerType, apiKey) {
  return post(`/api/v1/providers/${projectId}/providers`, { name, providerType, apiKey })
}

export function updateProvider(projectId, providerId, updates) {
  return patch(`/api/v1/providers/${projectId}/providers/${providerId}`, updates)
}

export function deleteProvider(projectId, providerId) {
  return del(`/api/v1/providers/${projectId}/providers/${providerId}`)
}

export function testProvider(projectId, providerId) {
  return post(`/api/v1/providers/${projectId}/providers/${providerId}/test`)
}

export function fetchProviderConfig(projectId) {
  return get(`/api/v1/providers/projects/${projectId}/provider`).then(r => r.data)
}

export function setProviderConfig(projectId, config) {
  return put(`/api/v1/providers/projects/${projectId}/provider`, config)
}

export function deleteProviderConfig(projectId) {
  return del(`/api/v1/providers/projects/${projectId}/provider`)
}

export function testProviderConnection(projectId, config) {
  return post(`/api/v1/providers/projects/${projectId}/provider/test`, config)
}
