import { get, post, patch, del } from './client'

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
