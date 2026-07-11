import { get, post, patch, del } from './client'

export interface Credential {
  id: string
  projectId: string
  name: string
  credentialType: string
  keyMasked: string
  metadata: Record<string, unknown> | null
  expiresAt: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export function getActiveCredentials(projectId: string): Promise<Credential[]> {
  return get<Credential[]>(`/api/v1/credentials/${projectId}/credentials`).catch(() => []) as Promise<Credential[]>
}

export function addCredential(projectId: string, data: { name: string; type: string; key: string; metadata?: Record<string, unknown>; expiresAt?: string }) {
  return post(`/api/v1/credentials/${projectId}/credentials`, data)
}

export function updateCredential(projectId: string, credentialId: string, data: Partial<{ name: string; type: string; key: string; metadata: Record<string, unknown>; expiresAt: string; isActive: boolean }>) {
  return patch(`/api/v1/credentials/${projectId}/credentials/${credentialId}`, data)
}

export function deleteCredential(projectId: string, credentialId: string) {
  return del(`/api/v1/credentials/${projectId}/credentials/${credentialId}`)
}
