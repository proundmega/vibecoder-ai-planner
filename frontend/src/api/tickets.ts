import { get, post, put, del } from './client'

export interface TicketBlocker {
  id: string
  title?: string | null
  status?: string | null
  phase?: string | null
  reason: string
}

export interface Ticket {
  id: string
  title: string
  description?: string | null
  status: string
  priority: string
  projectId: string
  ownerId?: string
  assigneeId?: string | null
  assigneeName?: string | null
  milestoneId?: string | null
  estimate?: number | null
  dependsOn?: string[]
  ready?: boolean
  blockedBy?: TicketBlocker[]
  planningStatus?: string
  templateSchema?: string | null
  phase?: string
  createdAt?: string
  updatedAt?: string
}

export function blockerSummary(ticket: Ticket): string | null {
  if (ticket.ready !== false) return null
  const first = ticket.blockedBy?.[0]
  return first?.title || first?.reason || 'Blocked by dependencies'
}

export interface Comment {
  id: string
  ticket_id: string
  content: string
  user_id: string
  created_at?: string
}

export function fetchTickets(projectId: string): Promise<Ticket[]> {
  return get<Ticket[]>(`/api/v1/projects/${projectId}/tickets`).catch(() => [])
}

export function fetchTicket(id: string): Promise<Ticket | null> {
  return get<Ticket>(`/api/v1/tickets/${id}`).catch(() => null)
}

export function updateTicket(id: string, updates: Partial<Ticket>): Promise<Ticket | null> {
  return put<Ticket>(`/api/v1/tickets/${id}`, updates).catch(() => null)
}

export function createTicket(projectId: string, title: string, description?: string): Promise<Ticket | null> {
  return post<Ticket>('/api/v1/tickets', { projectId, title, description }).catch(() => null)
}

export function deleteTicket(id: string): Promise<void> {
  return del<void>(`/api/v1/tickets/${id}`)
}

export function fetchComments(ticketId: string): Promise<Comment[]> {
  return get<Comment[]>(`/api/v1/tickets/${ticketId}/comments`).catch(() => [])
}

export function addComment(ticketId: string, content: string): Promise<Comment | null> {
  return post<Comment>(`/api/v1/tickets/${ticketId}/comments`, { content }).catch(() => null)
}

export function fetchProjectUsers(projectId: string): Promise<{ id: string; name: string; email: string }[]> {
  return get<{ id: string; name: string; email: string }[]>(`/api/v1/projects/${projectId}/users`).catch(() => [])
}
