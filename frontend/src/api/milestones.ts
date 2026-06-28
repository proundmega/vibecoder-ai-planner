import { get, post, put } from './client'

export interface Milestone {
  id: string
  project_id: string
  name: string
  description: string | null
  target_date: string | null
  is_active: boolean
  created_at: string
}

export interface MilestoneProgress {
  totalEstimate: number
  completedEstimate: number
  percentage: number
}

export interface Ticket {
  id: string
  title: string
  description: string | null
  status: string
  phase: string
  priority: string
  assigneeId: string | null
  milestone_id: string | null
  estimate: number | null
  depends_on: string[]
  created_at: string
}

export function listMilestones(projectId: string): Promise<Milestone[]> {
  return get(`/api/v1/projects/${projectId}/milestones`)
}

export function createMilestone(projectId: string, data: { name: string; description?: string; target_date?: string }): Promise<Milestone> {
  return post(`/api/v1/projects/${projectId}/milestones`, data)
}

export function updateMilestone(id: string, data: Partial<Milestone>): Promise<Milestone> {
  return put(`/api/v1/milestones/${id}`, data)
}

export function getMilestoneProgress(id: string): Promise<MilestoneProgress> {
  return get(`/api/v1/milestones/${id}/progress`)
}

export function getMilestoneTickets(id: string): Promise<Ticket[]> {
  return get(`/api/v1/milestones/${id}/tickets`)
}
