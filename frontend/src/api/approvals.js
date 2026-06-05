import { get, post } from './client'

export function createApproval(ticketId) {
  return post('/api/approvals', { ticketId })
}

export function getPendingApprovals() {
  return get('/api/approvals/pending')
}

export function getTicketApprovals(ticketId) {
  return get(`/api/approvals/ticket/${ticketId}`)
}

export function approveRequest(approvalId) {
  return post(`/api/approvals/${approvalId}/approve`)
}

export function rejectRequest(approvalId) {
  return post(`/api/approvals/${approvalId}/reject`)
}
