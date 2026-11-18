import { get, post, del } from './client'

export interface EnrollmentToken {
  id: number
  project_id: number
  provider_id: number | null
  name: string
  max_uses: number
  used_count: number
  expires_at: string
  revoked_at: string | null
  created_at: string
}

export interface MintedEnrollmentToken {
  id: number
  project_id: number
  provider_id: number | null
  name: string
  max_uses: number
  token: string
  expires_at: string
}

export interface MintEnrollmentTokenParams {
  projectId: number | string
  name: string
  ttlSeconds?: number
  maxUses?: number
  providerId?: number | string | null
}

export function mintEnrollmentToken(
  params: MintEnrollmentTokenParams,
): Promise<MintedEnrollmentToken> {
  return post<MintedEnrollmentToken>('/api/v1/agent-enrollment/tokens', {
    project_id: params.projectId,
    name: params.name,
    ttl_seconds: params.ttlSeconds,
    max_uses: params.maxUses,
    provider_id: params.providerId ?? null,
  })
}

export function listEnrollmentTokens(projectId: number | string): Promise<EnrollmentToken[]> {
  return get<EnrollmentToken[]>(
    `/api/v1/agent-enrollment/tokens?project_id=${encodeURIComponent(projectId)}`,
  )
}

export function revokeEnrollmentToken(id: number | string): Promise<{ id: number; revoked_at: string }> {
  return del<{ id: number; revoked_at: string }>(`/api/v1/agent-enrollment/tokens/${id}`)
}
