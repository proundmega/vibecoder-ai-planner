import { get } from './client'

export interface Billing {
  project_id: string
  user_id: string | null
  current_period_start: string
  current_period_end: string
  total_usage: number
  total_cost: number
  plan: string
}

export function getProjectBilling(projectId: string): Promise<Billing | null> {
  return get<Billing>(`/api/v1/billing/projects/${projectId}/billing`).catch(() => null) as Promise<Billing | null>
}

export function getUserBilling(): Promise<Billing[] | null> {
  return get<Billing[]>('/api/v1/billing/users/me/billing').catch(() => null) as Promise<Billing[] | null>
}
