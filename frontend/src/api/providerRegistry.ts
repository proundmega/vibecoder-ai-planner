import { get, post, patch, del } from './client'
import type { AgentRuntimeRole, ReasoningEffort, ResourceId } from './agentNodes'

export type ProviderCredentialStatus = 'active' | 'disabled'
export type ProviderModelStatus = 'unverified' | 'verified' | 'disabled'
export type ProviderModelSource = 'discovered' | 'manual'

export interface ProviderModel {
  id: ResourceId
  credential_id: ResourceId
  model: string
  display_name: string | null
  source: ProviderModelSource
  status: ProviderModelStatus
  roles: AgentRuntimeRole[]
  max_tokens: number | null
  context_window: number | null
  effort: ReasoningEffort
  last_verified_at: string | null
  last_verify_error: string | null
  created_at: string
  updated_at: string
}

export interface ProviderCredential {
  id: ResourceId
  owner_id: ResourceId
  project_id: ResourceId | null
  name: string
  provider_type: string
  base_url: string | null
  version: number
  status: ProviderCredentialStatus
  created_at: string
  updated_at: string
  /** Secrets are never returned; the backend may include a masked value. */
  apiKey?: string | null
  api_key_masked?: string | null
  /** The list endpoint returns each credential with its models. */
  models?: ProviderModel[]
}

export interface CreateCredentialInput {
  name: string
  providerType: string
  apiKey: string
  baseUrl?: string
  projectId?: ResourceId
}

export interface UpdateCredentialInput {
  name?: string
  apiKey?: string
  baseUrl?: string
  status?: ProviderCredentialStatus
}

export interface CreateModelInput {
  model: string
  displayName?: string
  roles?: AgentRuntimeRole[]
  maxTokens?: number | null
  contextWindow?: number | null
  effort?: ReasoningEffort
}

export interface UpdateModelInput {
  roles?: AgentRuntimeRole[]
  status?: ProviderModelStatus
  maxTokens?: number | null
  effort?: ReasoningEffort
}

export interface ProviderModelTestResult {
  verified: boolean
  /** Track A currently returns the verified model row, not a latency. */
  latencyMs?: number
  model?: ProviderModel
  error?: string | null
}

export interface CredentialReference {
  id?: ResourceId
  name?: string
  model?: string
  [key: string]: unknown
}

export type CredentialReferenceList = Array<ResourceId | CredentialReference>

export interface CredentialInUseError extends Error {
  status?: number
  referencingRuntimes?: CredentialReferenceList
  referencingModels?: CredentialReferenceList
}

export function listCredentials(): Promise<ProviderCredential[]> {
  return get<ProviderCredential[]>('/api/v1/provider-credentials')
}

export function listCredentialModels(credentialId: ResourceId): Promise<ProviderModel[]> {
  return get<ProviderModel[]>(`/api/v1/provider-credentials/${credentialId}/models`)
}

export function createCredential(input: CreateCredentialInput): Promise<ProviderCredential> {
  return post<ProviderCredential>('/api/v1/provider-credentials', input)
}

export function updateCredential(
  credentialId: ResourceId,
  updates: UpdateCredentialInput
): Promise<ProviderCredential> {
  return patch<ProviderCredential>(`/api/v1/provider-credentials/${credentialId}`, updates)
}

/**
 * Delete a credential. A credential referenced by runtimes or models returns
 * 409; keep the reference lists on the thrown error so the view can explain
 * which objects block the delete.
 */
export function deleteCredential(credentialId: ResourceId): Promise<void> {
  return del<void>(`/api/v1/provider-credentials/${credentialId}`).catch((err: unknown) => {
    const error = err as CredentialInUseError & {
      details?: {
        referencingRuntimes?: CredentialReferenceList
        referencingModels?: CredentialReferenceList
      }
    }
    if (error.status === 409) {
      error.referencingRuntimes = error.referencingRuntimes ?? error.details?.referencingRuntimes
      error.referencingModels = error.referencingModels ?? error.details?.referencingModels
    }
    throw error
  })
}

export function discoverModels(credentialId: ResourceId): Promise<ProviderModel[]> {
  return post<ProviderModel[]>(`/api/v1/provider-credentials/${credentialId}/discover`)
}

export function addModel(credentialId: ResourceId, input: CreateModelInput): Promise<ProviderModel> {
  return post<ProviderModel>(`/api/v1/provider-credentials/${credentialId}/models`, input)
}

export function testModel(modelId: ResourceId): Promise<ProviderModelTestResult> {
  return post<ProviderModelTestResult>(`/api/v1/provider-models/${modelId}/test`)
}

export function deleteModel(modelId: ResourceId): Promise<void> {
  return del<void>(`/api/v1/provider-models/${modelId}`)
}

export function updateModel(modelId: ResourceId, updates: UpdateModelInput): Promise<ProviderModel> {
  return patch<ProviderModel>(`/api/v1/provider-models/${modelId}`, updates)
}
