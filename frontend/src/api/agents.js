import { get, post, del } from './client'

export function getAgentKeyInfo(agentId) {
  return get(`/api/v1/agents/${agentId}/key`)
}

export function createAgent(name) {
  return post('/api/v1/agents/create', { name })
}

export function listAgents() {
  return get('/api/v1/agents/')
}

export function getAgentHistory(agentId, apiKey = null) {
  const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
  return get(`/api/v1/agents/${agentId}/history`, options)
}

export function fetchAgentStatusList() {
  return get('/api/v1/agents-status')
}

export function fetchAgentDetail(agentId) {
  return get(`/api/v1/agents-status/${agentId}`)
}

export function deleteAgent(agentId) {
  return del(`/api/v1/agents/${agentId}`)
}

export function revokeAgentKey(agentId) {
  return post(`/api/v1/agents/revoke/${agentId}`)
}
