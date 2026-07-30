import { get, del } from './client'

export interface CspViolation {
  id: number
  violated_directive: string
  blocked_uri: string
  document_uri: string
  referrer: string
  created_at: string
}

export interface CspViolationsResponse {
  violations: CspViolation[]
  total: number
  limit: number
  offset: number
}

export async function getCspViolations(params: {
  limit?: number
  offset?: number
  directive?: string
}): Promise<CspViolationsResponse> {
  const urlParams = new URLSearchParams()
  if (params.limit) urlParams.append('limit', String(params.limit))
  if (params.offset) urlParams.append('offset', String(params.offset))
  if (params.directive) urlParams.append('directive', params.directive)

  const queryString = urlParams.toString()
  const response = await get<CspViolationsResponse>(`/api/v1/csp-violations${queryString ? '?' + queryString : ''}`)
  return response
}

export async function clearCspViolations(): Promise<{ deletedCount: number }> {
  const response = await del<{ deletedCount: number }>('/api/v1/csp-violations')
  return response
}
