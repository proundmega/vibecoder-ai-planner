import { get, post, put, del } from './client'

export function fetchTickets(projectId) {
  return get(`/api/projects/${projectId}/tickets`).catch(() => [])
}

export function fetchTicket(id) {
  return get(`/api/tickets/${id}`).catch(() => null)
}

export function updateTicket(id, updates) {
  return put(`/api/tickets/${id}`, updates).catch(() => null)
}

export function createTicket(projectId, title, description) {
  return post('/api/tickets', { projectId, title, description }).catch(() => null)
}

export function deleteTicket(id) {
  return del(`/api/tickets/${id}`)
}

export function fetchComments(ticketId) {
  return get(`/api/tickets/${ticketId}/comments`).catch(() => [])
}

export function addComment(ticketId, content) {
  return post(`/api/tickets/${ticketId}/comments`, { content }).catch(() => null)
}

export function fetchProjectUsers(projectId) {
  return get(`/api/projects/${projectId}/users`).catch(() => [])
}
