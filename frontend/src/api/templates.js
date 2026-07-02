import { get, post, put, del } from './client'

export function listTemplates(projectId) {
  return get(`/api/v1/projects/${projectId}/templates`)
}

export function createTemplate(projectId, data) {
  return post(`/api/v1/projects/${projectId}/templates`, data)
}

export function updateTemplate(projectId, templateId, data) {
  return put(`/api/v1/projects/${projectId}/templates/${templateId}`, data)
}

export function deleteTemplate(projectId, templateId) {
  return del(`/api/v1/projects/${projectId}/templates/${templateId}`)
}
