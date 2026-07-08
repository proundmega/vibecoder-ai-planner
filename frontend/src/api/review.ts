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

export interface LocalDiffEntry {
  id?: string
  ticket_id?: string
  file_path: string
  action: string
  old_content?: string
  new_content?: string
  old_sha?: string
  new_sha?: string
  created_at?: string
}

export interface GithubDiffResponse {
  files: DiffEntry[]
  prNumber: number
}

export function getGithubDiff(ticketId: string): Promise<GithubDiffResponse> {
  return get<GithubDiffResponse>(`/api/v1/tickets/${ticketId}/review/diff`)
}

export function getLocalDiff(ticketId: string): Promise<LocalDiffEntry[]> {
  return get<{ files: LocalDiffEntry[] }>(`/api/v1/tickets/${ticketId}/review/local-diff`).then(
    (data) => data.files
  )
}

export function getComments(ticketId: string, type: string = 'review'): Promise<ReviewComment[]> {
  return get(`/api/v1/tickets/${ticketId}/comments?type=${type}`)
}

export function postComment(ticketId: string, data: { content: string; line?: number; type?: string }): Promise<ReviewComment> {
  return post(`/api/v1/tickets/${ticketId}/comments`, data)
}
