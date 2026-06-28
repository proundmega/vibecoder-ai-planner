import { get, post, del, patch } from './client'

export interface Environment {
  id: string
  project_id: string
  name: string
  webhook_url: string
  branch_pattern: string
  is_active: boolean
  created_at: string
}

export interface Deployment {
  id: string
  ticket_id: string
  environment_id: string
  environment_name?: string
  status: 'pending' | 'triggered' | 'success' | 'failed'
  commit_sha: string | null
  deployed_at: string
  rolled_back_at: string | null
  metadata: Record<string, any> | null
}

export function listEnvironments(projectId: string): Promise<Environment[]> {
  return get(`/api/v1/projects/${projectId}/environments`)
}

export function createEnvironment(projectId: string, data: { name: string; webhook_url: string; branch_pattern?: string }): Promise<Environment> {
  return post(`/api/v1/projects/${projectId}/environments`, data)
}

export function deleteEnvironment(id: string): Promise<void> {
  return del(`/api/v1/environments/${id}`)
}

export function triggerDeploy(ticketId: string, environmentId: string): Promise<Deployment> {
  return post(`/api/v1/tickets/${ticketId}/deploy`, { environment_id: environmentId })
}

export function rollbackDeployment(id: string): Promise<void> {
  return post(`/api/v1/deployments/${id}/rollback`)
}

export function getDeploymentHistory(ticketId: string, limit = 20, offset = 0): Promise<Deployment[]> {
  return get(`/api/v1/tickets/${ticketId}/deployments?limit=${limit}&offset=${offset}`)
}

export function updateDeploymentStatus(id: string, status: string): Promise<Deployment> {
  return patch(`/api/v1/deployments/${id}/status`, { status })
}
