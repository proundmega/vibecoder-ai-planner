import { get, post } from './client'

export type NotificationType = 'question' | 'run_succeeded' | 'run_failed' | 'budget_exceeded'

export interface NotificationItem {
  id: number | string
  user_id: number | string
  project_id?: number | string | null
  ticket_id?: number | string | null
  run_id?: string | null
  question_id?: number | string | null
  type: NotificationType
  payload: {
    status?: string
    error?: string | null
    prUrl?: string | null
    preview?: string
    kind?: string
  }
  read_at?: string | null
  created_at?: string
}

export interface NotificationFilter {
  unread?: boolean
  limit?: number
  offset?: number
}

export function listNotifications(filter: NotificationFilter = {}): Promise<NotificationItem[]> {
  const params = new URLSearchParams()
  if (filter.unread) params.set('unread', 'true')
  if (filter.limit != null) params.set('limit', String(filter.limit))
  if (filter.offset != null) params.set('offset', String(filter.offset))
  const query = params.toString()
  return get<NotificationItem[]>(`/api/v1/notifications${query ? `?${query}` : ''}`)
}

export async function getUnreadCount(): Promise<number> {
  const data = await get<{ count: number }>('/api/v1/notifications/unread-count')
  return Number(data?.count) || 0
}

export function markNotificationRead(id: number | string): Promise<NotificationItem> {
  return post(`/api/v1/notifications/${id}/read`)
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return post('/api/v1/notifications/read-all')
}
