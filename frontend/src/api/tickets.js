export async function fetchTickets(projectId, token) {
  try {
    const response = await fetch(`/api/projects/${projectId}/tickets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : []
  } catch (err) {
    console.error('Failed to fetch tickets:', err)
    return []
  }
}

export async function fetchTicket(id, token) {
  try {
    const response = await fetch(`/api/tickets/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to fetch ticket:', err)
    return null
  }
}

export async function updateTicket(id, updates, token) {
  try {
    const response = await fetch(`/api/tickets/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(updates)
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to update ticket:', err)
    return null
  }
}

export async function createTicket(projectId, title, description, token) {
  try {
    const response = await fetch('/api/tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ projectId, title, description })
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to create ticket:', err)
    return null
  }
}

export async function deleteTicket(id, token) {
  try {
    const response = await fetch(`/api/tickets/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok
  } catch (err) {
    console.error('Failed to delete ticket:', err)
    return false
  }
}
