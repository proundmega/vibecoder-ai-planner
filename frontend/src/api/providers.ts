import { get, post, patch, del, put } from './client'

export interface Provider {
  id: string
  name: string
  provider_type: string
  project_id: string
  created_at: string
  updated_at: string
}

export interface ProviderConfig {
  project_id: string
  config: Record<string, unknown>
}

export function listProviders(projectId: string): Promise<Provider[]> {
  return get<Provider[]>(`/api/v1/providers/${projectId}/providers`).catch(() => []) as Promise<Provider[]>
}

export function addProvider(projectId: string, name: string, providerType: string, apiKey: string, options: Record<string, unknown> = {}): Promise<Provider> {
  return post<Provider>(`/api/v1/providers/${projectId}/providers`, {
    name,
    providerType,
    apiKey,
    ...options,
  })
}

export function updateProvider(projectId: string, providerId: string, updates: Partial<Provider>): Promise<Provider> {
  return patch<Provider>(`/api/v1/providers/${projectId}/providers/${providerId}`, updates)
}

export function deleteProvider(projectId: string, providerId: string): Promise<void> {
  return del<void>(`/api/v1/providers/${projectId}/providers/${providerId}`)
}

export function testProvider(projectId: string, providerId: string): Promise<{ success: boolean; message: string }> {
  return post<{ success: boolean; message: string }>(`/api/v1/providers/${projectId}/providers/${providerId}/test`, undefined)
}

export function setDirector(projectId: string, providerId: string): Promise<Provider> {
  return patch<Provider>(`/api/v1/providers/${projectId}/providers/${providerId}/directorate`, undefined)
}

export function fetchProviderConfig(projectId: string): Promise<ProviderConfig | null> {
  return get<ProviderConfig>(`/api/v1/providers/projects/${projectId}/provider`).catch(() => null) as Promise<ProviderConfig | null>
}

export function setProviderConfig(projectId: string, config: Record<string, unknown>): Promise<ProviderConfig | null> {
  return put<ProviderConfig>(`/api/v1/providers/projects/${projectId}/provider`, config).catch(() => null) as Promise<ProviderConfig | null>
}

export function deleteProviderConfig(projectId: string): Promise<void> {
  return del<void>(`/api/v1/providers/projects/${projectId}/provider`).catch(() => {})
}

export function testProviderConnection(projectId: string, config: Record<string, unknown>): Promise<{ success: boolean; message: string } | null> {
  return post<{ success: boolean; message: string }>(`/api/v1/providers/projects/${projectId}/provider/test`, config).catch(() => null) as Promise<{ success: boolean; message: string } | null>
}
