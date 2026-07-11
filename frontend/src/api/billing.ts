import { get } from './client'

export interface Billing {
  project_id: string
  project_name?: string
  billing_month: string
  total_cost_usd: number
  total_tokens_in: number
  total_tokens_out: number
  total_calls: number
}

export function getProjectBilling(projectId: string): Promise<Billing | null> {
  return get<Billing>(`/api/v1/billing/projects/${projectId}/billing`).catch(() => null) as Promise<Billing | null>
}

export function getUserBilling(): Promise<Billing[] | null> {
  return get<Billing[]>('/api/v1/billing/users/me/billing').catch(() => null) as Promise<Billing[] | null>
}
