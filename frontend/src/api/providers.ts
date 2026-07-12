import { get, post, patch, del } from './client'

export interface Provider {
  id: string
  name: string
  providerType: string
  apiKey?: string
  baseUrl?: string
  model?: string
  roles?: string[]
  maxTokens?: number
  temperature?: number
  isActive?: boolean
  endpoint_url?: string
  fallback_provider?: string | null
  routing_rules?: string
  is_project_director?: boolean
  createdAt: string
  updatedAt: string
}

export interface ProviderResolveInput {
  labels?: string[]
  priority?: string
  phase?: string
}

export interface ProviderResolveOutput {
  provider: string
  endpoint_url: string | null
  model: string
  api_key: string
  max_tokens: number
  temperature: number
  is_fallback: boolean
}

export function listProviders(): Promise<Provider[]> {
  return get<Provider[]>('/api/v1/providers').catch(() => []) as Promise<Provider[]>
}

export function addProvider(data: { name: string; providerType: string; apiKey?: string; baseUrl?: string; model?: string; roles?: string[]; maxTokens?: number; temperature?: number; endpoint_url?: string; fallback_provider?: string; routing_rules?: string; is_project_director?: boolean }): Promise<Provider> {
  return post<Provider>('/api/v1/providers', data)
}

export function getProvider(id: string): Promise<Provider> {
  return get<Provider>(`/api/v1/providers/${id}`)
}

export function updateProvider(id: string, updates: Partial<Provider>): Promise<Provider> {
  return patch<Provider>(`/api/v1/providers/${id}`, updates)
}

export function deleteProvider(id: string): Promise<void> {
  return del<void>(`/api/v1/providers/${id}`)
}

export function testProvider(id: string): Promise<{ success: boolean; valid: boolean; message: string }> {
  return post<{ success: boolean; valid: boolean; message: string }>(`/api/v1/providers/${id}/test`, undefined)
}

export function setDirector(id: string): Promise<Provider> {
  return patch<Provider>(`/api/v1/providers/${id}/directorship`, undefined)
}

export function getProviderAgents(id: string): Promise<{ id: string; name: string; provider_id: string }[]> {
  return get<{ id: string; name: string; provider_id: string }[]>(`/api/v1/providers/${id}/agents`)
}

export function resolveProvider(input: ProviderResolveInput): Promise<ProviderResolveOutput> {
  return post<ProviderResolveOutput>('/api/v1/providers/resolve', input)
}
