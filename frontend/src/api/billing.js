import { get } from './client'

export function getProjectBilling(projectId) {
  return get(`/api/v1/billing/projects/${projectId}/billing`).catch(() => null)
}

export function getUserBilling() {
  return get('/api/v1/billing/users/me/billing').catch(() => null)
}
