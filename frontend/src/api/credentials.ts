import { get, post, patch, del } from './client'

export function getActiveCredentials(projectId: string) {
  return get(`/api/v1/credentials/${projectId}/credentials`).catch(() => [])
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
