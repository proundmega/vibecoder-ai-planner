import { get, post, del } from './client'

export interface RepoStatus {
  project_id: string
  repo_url: string
  branch: string
  connected: boolean
  last_sync: string | null
}

export interface Branch {
  name: string
  sha: string
  protected: boolean
}

export interface PullRequest {
  id: number
  title: string
  state: string
  head: { ref: string; sha: string }
  base: { ref: string }
  created_at: string
}

export function getRepoStatus(projectId: string): Promise<RepoStatus | null> {
  return get<RepoStatus>(`/api/v1/github/${projectId}/repo`).catch(() => null) as Promise<RepoStatus | null>
}

export function connectRepo(projectId: string, repoUrl: string, branch: string): Promise<RepoStatus> {
  return post<RepoStatus>(`/api/v1/github/${projectId}/repo/connect`, { repoUrl, branch })
}

export function disconnectRepo(projectId: string): Promise<void> {
  return del<void>(`/api/v1/github/${projectId}/repo`)
}

export function listBranches(projectId: string): Promise<Branch[]> {
  return get<Branch[]>(`/api/v1/github/${projectId}/branches`).catch(() => []) as Promise<Branch[]>
}

export function createBranch(ticketId: string, branchName: string): Promise<{ name: string; sha: string }> {
  return post<{ name: string; sha: string }>(`/api/v1/github/${ticketId}/branch`, { branchName })
}

export function deleteBranch(ticketId: string): Promise<void> {
  return del<void>(`/api/v1/github/${ticketId}/branch`)
}

export function listPRs(projectId: string): Promise<PullRequest[]> {
  return get<PullRequest[]>(`/api/v1/github/${projectId}/prs`).catch(() => []) as Promise<PullRequest[]>
}

export function createPR(ticketId: string, title: string, body: string, branchName: string): Promise<PullRequest> {
  return post<PullRequest>(`/api/v1/github/${ticketId}/pr`, { title, body, branchName })
}
