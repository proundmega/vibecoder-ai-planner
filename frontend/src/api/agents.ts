import { get, post, del, put } from './client'

export interface AgentKeyInfo {
  name: string
  keyPreview: string
  rateLimit: number
  maxActionsPerDay: number
}

export interface Agent {
  id: number
  name: string
  api_key: string | null
  owner_id: number
  rate_limit: number
  max_actions_per_day: number
  current_daily_usage: number
  last_reset_at: string | null
  created_at: string
  updated_at: string
}

export interface AgentHistorySummary {
  agentName: string
  totalActions: number
  totalCost: number
  daily: { date: string; count: number; totalCost: number }[]
}

export interface AgentStatus {
  agent_id: number
  name: string
  status: string
  last_seen: string
  current_ticket_id: number | null
  current_ticket_title: string | null
  current_step: string | null
  actions_today: number
  cost_today: number
}

export function getAgentKeyInfo(agentId: string): Promise<AgentKeyInfo> {
  return get(`/api/v1/agents/${agentId}/key`)
}

export interface CreateAgentParams {
  name: string
  providerId?: string
  rateLimit?: number
  maxActionsPerDay?: number
  keyExpiryDays?: number
}

export function createAgent(params: CreateAgentParams): Promise<Agent & { generatedApiKey: string }> {
  return post<Agent & { generatedApiKey: string }>('/api/v1/agents/create', {
    name: params.name,
    providerId: params.providerId || undefined,
    rateLimit: params.rateLimit,
    maxActionsPerDay: params.maxActionsPerDay,
    keyExpiryDays: params.keyExpiryDays,
  })
}

export function listAgents(): Promise<{ agents: Agent[] }> {
  return get<{ agents: Agent[] }>('/api/v1/agents/')
}

export function getAgentHistory(agentId: string, apiKey: string | null = null): Promise<AgentHistorySummary> {
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

export interface UpdateAgentNameParams {
  name: string
}

export function updateAgentName(agentId: string, name: string): Promise<{ id: number; name: string }> {
  return put(`/api/v1/agents/${agentId}`, { name })
}

export interface ProviderConfig {
  providerType: string
  apiKey: string | null
  baseUrl: string | null
  model: string | null
  maxTokens: number | null
}

export function getAgentProviderConfig(agentId: string): Promise<ProviderConfig> {
  return get(`/api/v1/agents/${agentId}/provider-config`)
}
