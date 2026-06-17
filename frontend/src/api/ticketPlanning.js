import { get, put, post, patch } from './client'

export function listPlanningFiles(ticketId) {
  return get(`/api/v1/tickets/${ticketId}/planning`).catch(() => [])
}

export function getPlanningFile(ticketId, fileKey) {
  return get(`/api/v1/tickets/${ticketId}/planning/${fileKey}`).catch(() => null)
}

export function upsertPlanningFile(ticketId, fileKey, content) {
  return put(`/api/v1/tickets/${ticketId}/planning/${fileKey}`, { content })
}

export function applyTemplate(ticketId, templateName) {
  return post(`/api/v1/tickets/${ticketId}/planning/apply-template`, { templateName })
}

export function updatePlanningStatus(ticketId, status) {
  return patch(`/api/v1/tickets/${ticketId}/planning/status`, { status })
}
