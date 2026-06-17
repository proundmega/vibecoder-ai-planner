import { get, post, postWithHeaders } from './client'

export function createTicket(projectId, title, description, apiKey = null) {
  const headers = apiKey ? { 'x-api-key': apiKey } : {}
  return postWithHeaders('/api/v1/agents/tickets/create', { projectId, title, description }, headers)
}

export function updateTicket(ticketId, updates, apiKey = null) {
  const headers = apiKey ? { 'x-api-key': apiKey } : {}
  return postWithHeaders(`/api/v1/agents/agents/tickets/edit/${ticketId}`, updates, headers)
}

export function claimTicket(ticketId, apiKey = null) {
  const headers = apiKey ? { 'x-api-key': apiKey } : {}
  return postWithHeaders(`/api/v1/agents/agents/tickets/claim/${ticketId}`, {}, headers)
}

export function changeTicketStatus(ticketId, status, apiKey = null) {
  const headers = apiKey ? { 'x-api-key': apiKey } : {}
  return postWithHeaders(`/api/v1/agents/agents/tickets/status/${ticketId}`, { status }, headers)
}

export function getAgentTickets(projectId, apiKey = null) {
  const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
  return get(`/api/v1/agents/agents/tickets/my-tasks/${projectId}`, options)
}

export function getAgentKeyInfo(agentId) {
  return get(`/api/v1/agents/agents/${agentId}/key`)
}

export function createAgent(name) {
  return post('/api/v1/agents/agents/create', { name })
}

export function listAgents() {
  return get('/api/v1/agents/agents')
}

export function getAgentHistory(agentId, apiKey = null) {
  const options = apiKey ? { headers: { 'x-api-key': apiKey } } : {}
  return get(`/api/v1/agents/agents/${agentId}/history`, options)
}
