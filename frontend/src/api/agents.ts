import { get, post, del } from './client'

export interface AgentKeyInfo {
  agent_id: string
  api_key: string
  created_at: string
  expires_at: string | null
}

export interface Agent {
  id: string
  name: string
  project_id: string
  status: string
  created_at: string
  updated_at: string
}

export interface AgentHistoryEntry {
  id: string
  agent_id: string
  action: string
  details: Record<string, unknown>
  created_at: string
}

export interface AgentStatus {
  id: string
  agent_id: string
  status: string
  last_seen: string
  tasks_completed: number
  tasks_failed: number
}

export function getAgentKeyInfo(agentId: string): Promise<AgentKeyInfo> {
  return get(`/api/v1/agents/${agentId}/key`)
}

export function createAgent(name: string): Promise<Agent> {
  return post('/api/v1/agents/create', { name })
}

export function listAgents(): Promise<Agent[]> {
  return get('/api/v1/agents/')
}

export function getAgentHistory(agentId: string, apiKey: string | null = null): Promise<AgentHistoryEntry[]> {
  const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
  return get(`/api/v1/agents/${agentId}/history`, options as Record<string, unknown>)
}

export function fetchAgentStatusList(): Promise<AgentStatus[]> {
  return get('/api/v1/agents-status')
}

export function fetchAgentDetail(agentId: string): Promise<AgentStatus> {
  return get(`/api/v1/agents-status/${agentId}`)
}

export function deleteAgent(agentId: string): Promise<void> {
  return del(`/api/v1/agents/${agentId}`)
}

export function revokeAgentKey(agentId: string): Promise<void> {
  return post(`/api/v1/agents/revoke/${agentId}`)
}
