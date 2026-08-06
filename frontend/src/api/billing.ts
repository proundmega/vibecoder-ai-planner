import { get } from './client'

export interface Billing {
  provider_type: string
  model: string
  total_cost: number
  total_in: number
  total_out: number
  total_calls: number
  billing_month?: string
  project_id?: string
}

export function getProjectBilling(projectId: string): Promise<Billing[] | null> {
  return get<Billing[]>(`/api/v1/billing/projects/${projectId}/billing`).catch(() => null) as Promise<Billing[] | null>
}

export function getUserBilling(): Promise<Billing[] | null> {
  return get<Billing[]>('/api/v1/billing/users/me/billing').catch(() => null) as Promise<Billing[] | null>
}
