/**
 * AI Agent API Client
 * Supports both user authentication (Bearer token) and agent authentication (x-api-key)
 */

/**
 * Create a ticket (supports both user and agent auth)
 * @param {string} projectId - ID of the project
 * @param {string} title - Ticket title
 * @param {string} description - Ticket description
 * @param {string} token - User Bearer token OR agent x-api-key
 * @param {string} apiKey - Optional agent API key (for multi-auth scenarios)
 * @returns {Promise<Object>} Created ticket
 */
export async function createTicket(projectId, title, description, token, apiKey = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch('http://localhost:3001/api/v1/agents/tickets/create', {
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

/**
 * Update or claim a ticket (supports agent auth)
 * @param {string} ticketId - ID of the ticket
 * @param {Object} updates - Ticket updates {title, description, status, priority}
 * @param {string} token - User Bearer token or agent x-api-key
 * @param {string} apiKey - Optional agent API key
 * @returns {Promise<Object>} Updated ticket info
 */
export async function updateTicket(ticketId, updates, token, apiKey = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`http://localhost:3001/api/v1/agents/tickets/edit/${ticketId}`, {
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

/**
 * Claim a ticket for agent processing
 * @param {string} ticketId - ID of the ticket
 * @param {string} token - User Bearer token or agent x-api-key
 * @param {string} apiKey - Optional agent API key
 * @returns {Promise<Object>} Claimed ticket with status 'in_progress'
 */
export async function claimTicket(ticketId, token, apiKey = null) {
  const headers = {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`http://localhost:3001/api/v1/agents/tickets/claim/${ticketId}`, {
    method: 'POST',
    headers
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to claim ticket')
  }

  return response.json()
}

/**
 * Change ticket status
 * @param {string} ticketId - ID of the ticket
 * @param {string} status - New status ('backlog', 'in_progress', 'review', 'done')
 * @param {string} token - User Bearer token or agent x-api-key
 * @param {string} apiKey - Optional agent API key
 * @returns {Promise<Object>} Status change confirmation
 */
export async function changeTicketStatus(ticketId, status, token, apiKey = null) {
  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`http://localhost:3001/api/v1/agents/tickets/status/${ticketId}`, {
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

/**
 * Get tickets assigned to or claimed by an agent
 * @param {string} projectId - Project ID
 * @param {string} token - User Bearer token or agent x-api-key
 * @param {string} apiKey - Optional agent API key
 * @returns {Promise<Object>} {tickets: [], count: number, agent: string}
 */
export async function getAgentTickets(projectId, token, apiKey = null) {
  const headers = {
    ...(apiKey ? { 'x-api-key': apiKey } : {}),
    'Authorization': `Bearer ${token}`
  }

  const response = await fetch(`http://localhost:3001/api/v1/agents/tickets/my-tasks/${projectId}`, {
    method: 'GET',
    headers
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch agent tickets')
  }

  return response.json()
}

/**
 * Get agent API key info
 * @param {string} agentId - ID of the agent
 * @param {string} token - User Bearer token (requires user auth, not agent auth)
 * @returns {Promise<Object>} Agent info with truncated key
 */
export async function getAgentKeyInfo(agentId, token) {
  const response = await fetch(`http://localhost:3001/api/v1/agents/${agentId}/key`, {
    headers: { 'Authorization': `Bearer ${token}` }
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch agent key info')
  }

  return response.json()
}

/**
 * Create a new agent for user
 * @param {string} name - Friendly name for the agent
 * @param {string} token - User Bearer token
 * @returns {Promise<Object>} Created agent with API key
 */
export async function createAgent(name, token) {
  const response = await fetch('http://localhost:3001/api/v1/agents/create', {
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

/**
 * List user's agents
 * @param {string} token - User Bearer token
 * @returns {Promise<Object>} {agents: []}
 */
export async function listAgents(token) {
  const response = await fetch('http://localhost:3001/api/v1/agents', {
    headers: { 'Authorization': `Bearer ${token}` }
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to list agents')
  }

  return response.json()
}

/**
 * Get agent activity history
 * @param {string} agentId - ID of the agent
 * @param {string} token - User Bearer token
 * @param {string} apiKey - Optional agent API key
 * @returns {Promise<Object>} Agent stats and history
 */
export async function getAgentHistory(agentId, token, apiKey = null) {
  const headers = {
    'Authorization': `Bearer ${token}`,
    ...(apiKey ? { 'x-api-key': apiKey } : {})
  }

  const response = await fetch(`http://localhost:3001/api/v1/agents/${agentId}/history`, {
    headers
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error || 'Failed to fetch agent history')
  }

  return response.json()
}
