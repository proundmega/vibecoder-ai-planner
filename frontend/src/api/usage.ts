import { get } from './client'

export interface Usage {
  provider_type?: string
  model: string
  total_in: number
  total_out: number
  total_cost: number
  total_calls: number
}

export interface ModelPricing {
  model: string
  pricing: {
    input_cost_per_million: number
    output_cost_per_million: number
  }
}

export interface UsageTotals {
  totalTokensIn: number
  totalTokensOut: number
  totalCost: number
  totalCalls: number
}

export interface UsageResponse {
  breakdown: Usage[]
  totals: UsageTotals
}

export function getProjectUsage(projectId: string): Promise<UsageResponse | null> {
  return get<UsageResponse>(`/api/v1/usage/projects/${projectId}/usage`).catch(() => null) as Promise<UsageResponse | null>
}

export function getUserUsage(): Promise<Usage[] | null> {
  return get<Usage[]>('/api/v1/usage/users/me/usage').catch(() => null) as Promise<Usage[] | null>
}

export function getModelPricing(): Promise<{ models: ModelPricing[] }> {
  return get<{ models: ModelPricing[] }>('/api/v1/usage/pricing/models').catch(() => ({ models: [] })) as Promise<{ models: ModelPricing[] }>
}
