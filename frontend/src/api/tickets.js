import { get, post, put, del } from './client'

export function fetchTickets(projectId) {
  return get(`/api/v1/projects/${projectId}/tickets`).catch(() => [])
}

export function fetchTicket(id) {
  return get(`/api/v1/tickets/${id}`).catch(() => null)
}

export function updateTicket(id, updates) {
  return put(`/api/v1/tickets/${id}`, updates).catch(() => null)
}

export function createTicket(projectId, title, description) {
  return post('/api/v1/tickets', { projectId, title, description }).catch(() => null)
}

export function deleteTicket(id) {
  return del(`/api/v1/tickets/${id}`)
}

export function fetchComments(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/comments`).catch(() => [])
}

export function addComment(ticketId, content) {
  return post(`/api/v1/tickets/${ticketId}/comments`, { content }).catch(() => null)
}

export function fetchProjectUsers(projectId) {
  return get(`/api/v1/projects/${projectId}/users`).catch(() => [])
}
