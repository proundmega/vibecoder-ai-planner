import { get, post, patch, del } from './client'

export type AgentRuntimeRole = 'worker' | 'reviewer' | 'planner'
export type AgentNodeStatus = 'active' | 'draining' | 'revoked'
export type AgentRuntimeStatus = 'pending' | 'running' | 'draining' | 'stopped'
export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'max'
export type ResourceId = number | string

export interface AgentRuntime {
  id: ResourceId
  node_id: ResourceId
  name: string
  role: AgentRuntimeRole
  model_id: ResourceId
  model_ref: string
  concurrency: number
  effort: ReasoningEffort | null
  status: AgentRuntimeStatus
  current_project_id: ResourceId | null
  last_seen_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentGrant {
  id: ResourceId
  node_id: ResourceId
  project_id: ResourceId
  role: AgentRuntimeRole
  created_by: ResourceId | null
  revoked_at: string | null
  created_at: string
  project_name?: string | null
}

export interface AgentNode {
  id: ResourceId
  owner_id: ResourceId
  name: string
  hostname: string | null
  fingerprint: string | null
  status: AgentNodeStatus
  last_seen_at: string | null
  created_at: string
  runtimes?: AgentRuntime[]
  grants?: AgentGrant[]
  owner_name?: string | null
}

export interface AgentGrantInput {
  projectId: ResourceId
  role: AgentRuntimeRole
}

export interface AgentRuntimeUpdate {
  effort?: ReasoningEffort | null
  concurrency?: number
  status?: AgentRuntimeStatus
}

export function listAgentNodes(): Promise<AgentNode[]> {
  return get<AgentNode[]>('/api/v1/agent-nodes')
}

export function getAgentNodeGrants(nodeId: ResourceId): Promise<AgentGrant[]> {
  return get<AgentGrant[]>(`/api/v1/agent-nodes/${nodeId}/grants`)
}

export function createAgentGrant(nodeId: ResourceId, grant: AgentGrantInput): Promise<AgentGrant> {
  return post<AgentGrant>(`/api/v1/agent-nodes/${nodeId}/grants`, grant)
}

export function revokeAgentGrant(nodeId: ResourceId, grantId: ResourceId): Promise<AgentGrant> {
  return del<AgentGrant>(`/api/v1/agent-nodes/${nodeId}/grants/${grantId}`)
}

export function drainAgentNode(nodeId: ResourceId): Promise<AgentNode> {
  return post<AgentNode>(`/api/v1/agent-nodes/${nodeId}/drain`)
}

export function revokeAgentNode(nodeId: ResourceId): Promise<AgentNode> {
  return post<AgentNode>(`/api/v1/agent-nodes/${nodeId}/revoke`)
}

export function updateAgentRuntime(
  runtimeId: ResourceId,
  updates: AgentRuntimeUpdate
): Promise<AgentRuntime> {
  return patch<AgentRuntime>(`/api/v1/agent-runtimes/${runtimeId}`, updates)
}
