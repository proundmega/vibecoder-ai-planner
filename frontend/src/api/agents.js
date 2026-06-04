/**
 * AI Agent API Client
 * Supports both user authentication (Bearer token) and agent authentication (x-api-key)
 */

export async function createTicket(projectId, title, description, token, apiKey = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch('/api/agents/tickets/create', {
    method: 'POST',
    headers,
    body: JSON.stringify({ projectId, title, description })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create ticket')
  }

  return response.json()
}

export async function updateTicket(ticketId, updates, token, apiKey = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`/api/agents/tickets/edit/${ticketId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(updates)
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to update ticket')
  }

  return response.json()
}

export async function claimTicket(ticketId, token, apiKey = null) {
  const headers = {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`/api/agents/tickets/claim/${ticketId}`, {
    method: 'POST',
    headers
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to claim ticket')
  }

  return response.json()
}

export async function changeTicketStatus(ticketId, status, token, apiKey = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`/api/agents/tickets/status/${ticketId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ status })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to change status')
  }

  return response.json()
}

export async function getAgentTickets(projectId, token, apiKey = null) {
  const headers = {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`/api/agents/tickets/my-tasks/${projectId}`, {
    method: 'GET',
    headers
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch agent tickets')
  }

  return response.json()
}

export async function getAgentKeyInfo(agentId, token) {
  const response = await fetch(`/api/agents/agents/${agentId}/key`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch agent key info')
  }

  return response.json()
}

export async function createAgent(name, token) {
  const response = await fetch('/api/agents/agents/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ name })
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to create agent')
  }

  return response.json()
}

export async function listAgents(token) {
  const response = await fetch('/api/agents/agents', {
    headers: { 'Authorization': `Bearer ${token}` }
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to list agents')
  }

  return response.json()
}

export async function getAgentHistory(agentId, token, apiKey = null) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(apiKey ? { 'x-api-key': apiKey } : {})
  }

  const response = await fetch(`/api/agents/agents/${agentId}/history`, {
    headers
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch agent history')
  }

  return response.json()
}
