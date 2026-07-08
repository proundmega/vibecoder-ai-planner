import { get, post, patch, del } from './client'

export function getActiveCredentials(projectId: string): Promise<Record<string, unknown>[]> {
  return get<Record<string, unknown>>(`/api/v1/credentials/${projectId}/credentials`).catch(() => []) as Promise<Record<string, unknown>[]>
}

export function addCredential(projectId: string, data: { name: string; credential: string }) {
  return post(`/api/v1/credentials/${projectId}/credentials`, data)
}

export function updateCredential(projectId: string, credentialId: string, data: Partial<{ name: string; credential: string }>) {
  return patch(`/api/v1/credentials/${projectId}/credentials/${credentialId}`, data)
}

export function deleteCredential(projectId: string, credentialId: string) {
  return del(`/api/v1/credentials/${projectId}/credentials/${credentialId}`)
}
