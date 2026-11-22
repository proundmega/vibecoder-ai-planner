import { get, post, put, del } from './client'

export interface TicketBlocker {
  id: string | null
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

export function dependencyBlockedMessage(details: unknown): string | null {
  const blockedBy = (details as { blockedBy?: TicketBlocker[] } | null)?.blockedBy
  if (!Array.isArray(blockedBy) || blockedBy.length === 0) return null
  return blockedBy
    .map(blocker => blocker.title || (blocker.id ? `#${blocker.id}` : blocker.reason))
    .join(', ')
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

// fg-45: errors must reach the view. A readiness rejection is a 409
// READINESS_FAILED with details.issues; swallowing it would leave the board
// optimistically wrong and hide the reason.
export function updateTicket(id: string, updates: Partial<Ticket>): Promise<Ticket> {
  return put<Ticket>(`/api/v1/tickets/${id}`, updates)
}

export interface CreateTicketOptions {
  description?: string
  priority?: string
  template?: string
  acceptanceCriteria?: string[]
  smallFix?: { reason: string }
}

export function createTicket(
  projectId: string,
  title: string,
  description?: string,
  options: Omit<CreateTicketOptions, 'description'> = {}
): Promise<Ticket> {
  const body: Record<string, unknown> = { projectId, title, description }
  if (options.priority) body.priority = options.priority
  if (options.template) body.template = options.template
  if (options.acceptanceCriteria && options.acceptanceCriteria.length > 0) {
    body.acceptanceCriteria = options.acceptanceCriteria
  }
  if (options.smallFix?.reason) body.smallFix = options.smallFix
  return post<Ticket>('/api/v1/tickets', body)
}

export interface ReadinessIssue {
  code: string
  message: string
  field?: string
  file?: string
  section?: string
  marker?: string
  waivable?: boolean
}

export interface ReadinessRequirement {
  id: string
  text: string
  acceptance?: string
}

export interface ReadinessResult {
  ready: boolean
  issues: ReadinessIssue[]
  waivedCodes: string[]
  template?: string | null
  templateName?: string | null
  sectionsEnforced?: boolean
  planningStatus?: string
  planApproved?: boolean
  overrideExpiresAt?: string | null
  smallFixReason?: string | null
  securitySensitive?: boolean
  grandfathered?: boolean
  canEditCriteria?: boolean
  requirements?: ReadinessRequirement[]
}

export interface AcceptanceCriterion {
  id: string
  ticket_id: string
  position: number
  text: string
}

export function readinessIssueSummary(details: unknown): string | null {
  const issues = (details as { issues?: ReadinessIssue[] } | null)?.issues
  if (!Array.isArray(issues) || issues.length === 0) return null
  return issues.map(issue => issue.code).join(', ')
}

export function fetchReadiness(ticketId: string): Promise<ReadinessResult> {
  return get<ReadinessResult>(`/api/v1/tickets/${ticketId}/readiness`)
}

export function approvePlan(ticketId: string): Promise<ReadinessResult> {
  return post<ReadinessResult>(`/api/v1/tickets/${ticketId}/readiness/approve-plan`)
}

export function recordSmallFix(ticketId: string, reason: string): Promise<ReadinessResult> {
  return post<ReadinessResult>(`/api/v1/tickets/${ticketId}/readiness/small-fix`, { reason })
}

export function replan(ticketId: string): Promise<ReadinessResult> {
  return post<ReadinessResult>(`/api/v1/tickets/${ticketId}/readiness/replan`)
}

export function grantOverride(
  ticketId: string,
  payload: { codes: string[]; reason: string; expiresAt: string }
): Promise<ReadinessResult> {
  return post<ReadinessResult>(`/api/v1/tickets/${ticketId}/readiness/override`, payload)
}

export function revokeOverride(ticketId: string): Promise<ReadinessResult> {
  return del<ReadinessResult>(`/api/v1/tickets/${ticketId}/readiness/override`)
}

export function fetchCriteria(ticketId: string): Promise<AcceptanceCriterion[]> {
  return get<AcceptanceCriterion[]>(`/api/v1/tickets/${ticketId}/acceptance-criteria`)
}

export function addCriteria(ticketId: string, criteria: string[]): Promise<AcceptanceCriterion[]> {
  return post<AcceptanceCriterion[]>(`/api/v1/tickets/${ticketId}/acceptance-criteria`, { criteria })
}

export function updateCriterion(ticketId: string, criterionId: string, text: string): Promise<AcceptanceCriterion> {
  return put<AcceptanceCriterion>(`/api/v1/tickets/${ticketId}/acceptance-criteria/${criterionId}`, { text })
}

export function deleteCriterion(ticketId: string, criterionId: string): Promise<void> {
  return del<void>(`/api/v1/tickets/${ticketId}/acceptance-criteria/${criterionId}`)
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
