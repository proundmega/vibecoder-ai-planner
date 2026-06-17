import { get, post, del } from './client'

export function getRepoStatus(projectId) {
  return get(`/api/v1/github/${projectId}/repo`).catch(() => null)
}

export function connectRepo(projectId, repoUrl, branch) {
  return post(`/api/v1/github/${projectId}/repo/connect`, { repoUrl, branch })
}

export function disconnectRepo(projectId) {
  return del(`/api/v1/github/${projectId}/repo`)
}

export function listBranches(projectId) {
  return get(`/api/v1/github/${projectId}/branches`).catch(() => [])
}

export function createBranch(ticketId, branchName) {
  return post(`/api/v1/github/${ticketId}/branch`, { branchName })
}

export function deleteBranch(ticketId) {
  return del(`/api/v1/github/${ticketId}/branch`)
}

export function listPRs(projectId) {
  return get(`/api/v1/github/${projectId}/prs`).catch(() => [])
}

export function createPR(ticketId, title, body, branchName) {
  return post(`/api/v1/github/${ticketId}/pr`, { title, body, branchName })
}
