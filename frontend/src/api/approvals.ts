import { get, post } from './client'

export interface Approval {
  id: string
  ticket_id: string
  status: string
  approved_by: string | null
  created_at: string
  updated_at: string
}

export function createApproval(ticketId: string): Promise<Approval> {
  return post('/api/v1/approvals', { ticketId })
}

export function getPendingApprovals(): Promise<Approval[]> {
  return get('/api/v1/approvals/pending')
}

export function getTicketApprovals(ticketId: string): Promise<Approval[]> {
  return get(`/api/v1/approvals/ticket/${ticketId}`)
}

export function approveRequest(approvalId: string): Promise<Approval> {
  return post(`/api/v1/approvals/${approvalId}/approve`)
}

export function rejectRequest(approvalId: string): Promise<Approval> {
  return post(`/api/v1/approvals/${approvalId}/reject`)
}
