import { get } from './client'

export function getProjectUsage(projectId) {
  return get(`/api/v1/usage/projects/${projectId}/usage`).catch(() => null)
}

export function getUserUsage() {
  return get('/api/v1/usage/users/me/usage').catch(() => null)
}

export function getModelPricing() {
  return get('/api/v1/usage/pricing/models').catch(() => [])
}
