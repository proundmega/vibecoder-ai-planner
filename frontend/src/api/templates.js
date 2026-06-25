import { get, post, del } from './client'

export function listTemplates(projectId) {
  return get(`/api/v1/projects/${projectId}/templates`).catch(() => [])
}

export function createTemplate(projectId, data) {
  return post(`/api/v1/projects/${projectId}/templates`, data)
}

export function deleteTemplate(projectId, templateId) {
  return del(`/api/v1/projects/${projectId}/templates/${templateId}`)
}
