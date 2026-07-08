import { get, post, put, del } from './client'

export interface Memory {
  id: string
  project_id: string
  agent_id: string | null
  content: string
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export function getProjectMemory(projectId: string): Promise<Memory[]> {
  return get<Memory[]>(`/api/v1/memory/project/${projectId}`).catch(() => []) as Promise<Memory[]>
}

export function searchMemory(projectId: string, query: string): Promise<Memory[]> {
  return get<Memory[]>(`/api/v1/memory/project/${projectId}/search?query=${encodeURIComponent(query)}`).catch(() => []) as Promise<Memory[]>
}

export function getAgentMemory(agentId: string): Promise<Memory[]> {
  return get<Memory[]>(`/api/v1/memory/agent/${agentId}`).catch(() => []) as Promise<Memory[]>
}

export function getMemory(id: string): Promise<Memory | null> {
  return get<Memory>(`/api/v1/memory/${id}`).catch(() => null) as Promise<Memory | null>
}

export function addMemory(projectId: string, content: string, metadata: Record<string, unknown> = {}): Promise<Memory> {
  return post<Memory>(`/api/v1/memory/project/${projectId}`, { content, metadata })
}

export function updateMemory(id: string, updates: Partial<Memory>): Promise<Memory> {
  return put<Memory>(`/api/v1/memory/${id}`, updates)
}

export function deleteMemory(id: string): Promise<void> {
  return del<void>(`/api/v1/memory/${id}`)
}
