import { get, post, put, del } from './client'

export interface Template {
  id: string
  name: string
  project_id: string
  content: string
  type: string
  created_at: string
  updated_at: string
}

export function listTemplates(projectId: string): Promise<Template[]> {
  return get(`/api/v1/projects/${projectId}/templates`)
}

export function createTemplate(projectId: string, data: { name: string; content: string; type: string }): Promise<Template> {
  return post(`/api/v1/projects/${projectId}/templates`, data)
}

export function updateTemplate(projectId: string, templateId: string, data: Partial<Template>): Promise<Template> {
  return put(`/api/v1/projects/${projectId}/templates/${templateId}`, data)
}

export function deleteTemplate(projectId: string, templateId: string): Promise<void> {
  return del(`/api/v1/projects/${projectId}/templates/${templateId}`)
}
