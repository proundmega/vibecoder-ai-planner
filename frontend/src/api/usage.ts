import { get } from './client'

export interface Usage {
  project_id: string
  user_id: string | null
  model: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost: number
  period: string
}

export interface ModelPricing {
  model: string
  input_cost_per_million: number
  output_cost_per_million: number
}

export function getProjectUsage(projectId: string): Promise<Usage | null> {
  return get<Usage>(`/api/v1/usage/projects/${projectId}/usage`).catch(() => null) as Promise<Usage | null>
}

export function getUserUsage(): Promise<Usage[]> {
  return get<Usage[]>('/api/v1/usage/users/me/usage').catch(() => []) as Promise<Usage[]>
}

export function getModelPricing(): Promise<ModelPricing[]> {
  return get<ModelPricing[]>('/api/v1/usage/pricing/models').catch(() => []) as Promise<ModelPricing[]>
}
