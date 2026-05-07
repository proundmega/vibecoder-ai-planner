export async function fetchProjects(token) {
  try {
    const response = await fetch('http://localhost:3001/api/v1/projects', {
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
    const response = await fetch('http://localhost:3001/api/v1/projects', {
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
