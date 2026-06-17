import { get, post } from './client'

export function createApproval(ticketId) {
  return post('/api/v1/approvals', { ticketId })
}

export function getPendingApprovals() {
  return get('/api/v1/approvals/pending')
}

export function getTicketApprovals(ticketId) {
  return get(`/api/v1/approvals/ticket/${ticketId}`)
}

export function approveRequest(approvalId) {
  return post(`/api/v1/approvals/${approvalId}/approve`)
}

export function rejectRequest(approvalId) {
  return post(`/api/v1/approvals/${approvalId}/reject`)
}
