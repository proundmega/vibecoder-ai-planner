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
  /** Parsed from `vibecode/ticket-<id>-<slug>`; null for other branches. */
  ticketId: string | null
}

export interface PullRequest {
  id: number
  number: number
  title: string
  state: string
  url: string
  head: string
  base: string
}

interface RawPullRequest {
  id: number
  number?: number
  title: string
  state: string
  url?: string
  html_url?: string
  head?: string | { ref?: string }
  base?: string | { ref?: string }
}

function branchName(row: string | { name?: string }): string {
  return typeof row === 'string' ? row : row?.name || ''
}

function ticketIdFromBranch(name: string): string | null {
  const match = name.match(/^vibecode\/ticket-(\d+)(?:-|$)/)
  return match ? match[1] : null
}

export function getRepoStatus(projectId: string): Promise<RepoStatus | null> {
  return get<RepoStatus>(`/api/v1/github/${projectId}/repo`).catch(() => null) as Promise<RepoStatus | null>
}

export function connectRepo(projectId: string, repoUrl: string, accessToken: string): Promise<RepoStatus> {
  return post<RepoStatus>(`/api/v1/github/${projectId}/repo/connect`, { repoUrl, accessToken })
}

export function disconnectRepo(projectId: string): Promise<void> {
  return del<void>(`/api/v1/github/${projectId}/repo`)
}

export function listBranches(projectId: string): Promise<Branch[]> {
  return get<Array<string | { name?: string }>>(`/api/v1/github/${projectId}/branches`)
    .then((rows) => (Array.isArray(rows) ? rows : [])
      .map((row) => branchName(row))
      .filter((name) => name.length > 0)
      .map((name) => ({ name, ticketId: ticketIdFromBranch(name) })))
    .catch(() => []) as Promise<Branch[]>
}

export function createBranch(ticketId: string, branchName: string, projectId?: string): Promise<{ name: string; sha: string }> {
  const body: { branchName: string; projectId?: string } = { branchName }
  if (projectId) body.projectId = projectId
  return post<{ name: string; sha: string }>(`/api/v1/github/${ticketId}/branch`, body)
}

export function deleteBranch(ticketId: string): Promise<void> {
  return del<void>(`/api/v1/github/${ticketId}/branch`)
}

export function listPRs(projectId: string): Promise<PullRequest[]> {
  return get<RawPullRequest[]>(`/api/v1/github/${projectId}/prs`)
    .then((rows) => (Array.isArray(rows) ? rows : []).map((pr) => ({
      id: pr.id,
      number: pr.number ?? 0,
      title: pr.title,
      state: pr.state,
      url: pr.url || pr.html_url || '',
      head: typeof pr.head === 'string' ? pr.head : pr.head?.ref || '',
      base: typeof pr.base === 'string' ? pr.base : pr.base?.ref || '',
    })))
    .catch(() => []) as Promise<PullRequest[]>
}

export function createPR(ticketId: string, description: string, projectId?: string): Promise<PullRequest> {
  return post<PullRequest>(`/api/v1/github/${ticketId}/pr`, { description, projectId })
}
