import { get, post, del } from './client'

export interface RepoStatus {
  id: string | number | null
  projectId: string
  repoUrl: string
  defaultBranch: string
  isActive: boolean
  connected: boolean
}

interface RawRepoStatus {
  id?: string | number | null
  projectId?: string | number | null
  project_id?: string | number | null
  repoUrl?: string | null
  repo_url?: string | null
  defaultBranch?: string | null
  default_branch?: string | null
  branch?: string | null
  isActive?: boolean | null
  is_active?: boolean | null
  connected?: boolean | null
}

/**
 * The backend returns the persisted repo row (`repoUrl`, `defaultBranch`,
 * `isActive`). Normalize it to the UI contract and tolerate the legacy
 * snake_case shape used by older mocks/clients.
 */
export function normalizeRepoStatus(raw: RawRepoStatus | null | undefined): RepoStatus | null {
  if (!raw) return null
  const repoUrl = raw.repoUrl ?? raw.repo_url ?? ''
  const defaultBranch = raw.defaultBranch ?? raw.default_branch ?? raw.branch ?? ''
  const isActive = raw.isActive ?? raw.is_active ?? raw.connected ?? Boolean(repoUrl)
  return {
    id: raw.id ?? null,
    projectId: String(raw.projectId ?? raw.project_id ?? ''),
    repoUrl,
    defaultBranch,
    isActive,
    connected: typeof raw.connected === 'boolean' ? raw.connected : Boolean(isActive && repoUrl),
  }
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

export interface CreatedBranch {
  branchName: string
  ticketId: string | number
}

export interface CreatedPullRequest {
  id: number
  number: number
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
  return get<RawRepoStatus | null>(`/api/v1/github/${projectId}/repo`)
    .then(normalizeRepoStatus)
    .catch(() => null)
}

export function connectRepo(projectId: string, repoUrl: string, accessToken: string): Promise<RepoStatus | null> {
  return post<RawRepoStatus>(`/api/v1/github/${projectId}/repo/connect`, { repoUrl, accessToken })
    .then(normalizeRepoStatus)
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

export function createBranch(ticketId: string, branchName: string, projectId?: string): Promise<CreatedBranch> {
  const body: { branchName: string; projectId?: string } = { branchName }
  if (projectId) body.projectId = projectId
  return post<CreatedBranch>(`/api/v1/github/${ticketId}/branch`, body)
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

export function createPR(ticketId: string, description: string, projectId?: string): Promise<CreatedPullRequest> {
  return post<CreatedPullRequest>(`/api/v1/github/${ticketId}/pr`, { description, projectId })
}
