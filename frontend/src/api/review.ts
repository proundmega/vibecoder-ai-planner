import { get, post } from './client'

export interface ReviewComment {
  id: string
  ticket_id: string
  type: string
  content: string
  line?: number
  author: string
  created_at: string
}

export interface DiffEntry {
  path: string
  old_path: string | null
  old_sha: string
  new_sha: string
  status: string
  additions: number
  deletions: number
  patch: string
}

export function getGithubDiff(ticketId: string): Promise<DiffEntry[]> {
  return get(`/api/v1/tickets/${ticketId}/review/diff`)
}

export function getComments(ticketId: string, type: string = 'review'): Promise<ReviewComment[]> {
  return get(`/api/v1/tickets/${ticketId}/comments?type=${type}`)
}

export function postComment(ticketId: string, data: { content: string; line?: number; type?: string }): Promise<ReviewComment> {
  return post(`/api/v1/tickets/${ticketId}/comments`, data)
}
