import { get, put, post, patch } from './client'

export interface PlanningFile {
  key: string
  content: string
  updated_at: string
}

export function listPlanningFiles(ticketId: string): Promise<PlanningFile[]> {
  return get<PlanningFile[]>(`/api/v1/tickets/${ticketId}/planning`).catch(() => []) as Promise<PlanningFile[]>
}

export function getPlanningFile(ticketId: string, fileKey: string): Promise<PlanningFile | null> {
  return get<PlanningFile>(`/api/v1/tickets/${ticketId}/planning/${fileKey}`).catch(() => null) as Promise<PlanningFile | null>
}

export function upsertPlanningFile(ticketId: string, fileKey: string, content: string): Promise<PlanningFile> {
  return put<PlanningFile>(`/api/v1/tickets/${ticketId}/planning/${fileKey}`, { content })
}

export function applyTemplate(ticketId: string, templateName: string): Promise<PlanningFile[]> {
  return post<PlanningFile[]>(`/api/v1/tickets/${ticketId}/planning/apply-template`, { templateName })
}

export function updatePlanningStatus(ticketId: string, status: string): Promise<{ status: string }> {
  return patch<{ status: string }>(`/api/v1/tickets/${ticketId}/planning/status`, { status })
}
