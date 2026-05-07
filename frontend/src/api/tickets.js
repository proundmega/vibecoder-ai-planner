export async function fetchTicket(id, token) {
  try {
    const response = await fetch(`http://localhost:3001/api/v1/tickets/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to fetch ticket:', err)
    return null
  }
}

export async function fetchTickets(projectId, token) {
  try {
    const response = await fetch(`http://localhost:3001/api/v1/project/${projectId}/tickets`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : []
  } catch (err) {
    console.error('Failed to fetch tickets:', err)
    return []
  }
}

export async function updateTicket(id, updates, token) {
  try {
    const response = await fetch(`http://localhost:3001/api/v1/tickets/${id}`, {
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

export async function addComment(ticketId, text, token) {
  try {
    const response = await fetch(`http://localhost:3001/api/v1/tickets/${ticketId}/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ text })
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to add comment:', err)
    return null
  }
}

export async function getComments(ticketId, token) {
  try {
    const response = await fetch(`http://localhost:3001/api/v1/tickets/${ticketId}/comments`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : []
  } catch (err) {
    console.error('Failed to get comments:', err)
    return []
  }
}

export async function fetchProjectByName(projectName, token) {
  try {
    const response = await fetch('http://localhost:3001/api/v1/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    if (response.ok) {
      const projects = await response.json()
      return projects.find(p => p.name === projectName) || null
    }
    return null
  } catch (err) {
    console.error('Failed to fetch projects:', err)
    return null
  }
}

export async function createTicket(projectId, title, description, token) {
  try {
    const response = await fetch('http://localhost:3001/api/v1/tickets', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ project_id: projectId, title, description })
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to create ticket:', err)
    return null
  }
}
