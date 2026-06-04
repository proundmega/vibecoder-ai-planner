export async function fetchProjects(token) {
  try {
    const response = await fetch('/api/projects', {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : []
  } catch (err) {
    console.error('Failed to fetch projects:', err)
    return []
  }
}

export async function createProject(name, description, token) {
  try {
    const response = await fetch('/api/projects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, description })
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to create project:', err)
    return null
  }
}

export async function fetchProjectById(id, token) {
  try {
    const response = await fetch(`/api/projects/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to fetch project:', err)
    return null
  }
}

export async function updateProject(id, name, description, token) {
  try {
    const response = await fetch(`/api/projects/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ name, description })
    })
    return response.ok ? await response.json() : null
  } catch (err) {
    console.error('Failed to update project:', err)
    return null
  }
}

export async function deleteProject(id, token) {
  try {
    const response = await fetch(`/api/projects/${id}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` }
    })
    return response.ok ? await response.json() : { error: response.statusText }
  } catch (err) {
    console.error('Failed to delete project:', err)
    return { error: err.message }
  }
}
