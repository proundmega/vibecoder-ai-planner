import { get, post } from './client'

export type QuestionKind = 'question' | 'permission' | 'doom_loop'
export type QuestionStatus = 'pending' | 'answered' | 'expired' | 'cancelled'

export interface TicketQuestion {
  id: number | string
  run_id: string
  ticket_id: number | string
  project_id: number | string
  runtime_id: number | string
  kind: QuestionKind
  status: QuestionStatus
  prompt: string
  options?: unknown
  answer?: string | null
  answered_at?: string | null
  expires_at?: string | null
  created_at?: string
  ticket_title?: string | null
  project_name?: string | null
}

export interface QuestionFilter {
  status?: QuestionStatus | ''
  limit?: number
  offset?: number
}

function queryString(filter: QuestionFilter = {}): string {
  const params = new URLSearchParams()
  if (filter.status) params.set('status', filter.status)
  if (filter.limit != null) params.set('limit', String(filter.limit))
  if (filter.offset != null) params.set('offset', String(filter.offset))
  const encoded = params.toString()
  return encoded ? `?${encoded}` : ''
}

function withQuery(path: string, filter: QuestionFilter = {}): string {
  return `${path}${queryString(filter)}`
}

/** Cross-project inbox for the signed-in user. */
export function listInboxQuestions(filter: QuestionFilter = {}): Promise<TicketQuestion[]> {
  return get<TicketQuestion[]>(withQuery('/api/v1/harness/questions', filter))
}

export function listTicketQuestions(
  ticketId: number | string,
  filter: QuestionFilter = {},
): Promise<TicketQuestion[]> {
  return get<TicketQuestion[]>(withQuery(`/api/v1/harness/tickets/${ticketId}/questions`, filter))
}

export function listRunQuestions(
  runId: string,
  filter: QuestionFilter = {},
): Promise<TicketQuestion[]> {
  return get<TicketQuestion[]>(withQuery(`/api/v1/harness/runs/${runId}/questions`, filter))
}

export function answerQuestion(
  runId: string,
  questionId: number | string,
  answer: string,
): Promise<{ id: number | string; status: QuestionStatus; answeredAt?: string | null }> {
  return post(`/api/v1/harness/runs/${runId}/questions/${questionId}/answer`, { answer })
}
