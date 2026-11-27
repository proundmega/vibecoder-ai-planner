/**
 * Hand-written provider-neutral Git client (like `github.ts`). The generated
 * `api/generated` client is intentionally not used for Git; regenerate the
 * OpenAPI spec with `npm run generate:spec` when route JSDoc changes.
 */
import { get, post, del } from './client'
import {
  normalizeRepoStatus,
  ticketIdFromBranch,
  type RawRepoStatus,
  type RepoStatus,
  type Branch,
} from './github'

/** Provider capability row returned by `GET /api/v1/git/providers`. */
export interface GitCapabilities {
  id: string
  label: string
  supportsReviewRequests: boolean
  supportsInstallations: boolean
  requiresBaseUrl: boolean
  reviewRequestName: string
  authModes: string[]
  registered: boolean
}

/** Connection row returned by the generic Git routes. */
export interface GitRepoStatus extends RepoStatus {
  provider: string
  providerBaseUrl: string | null
  providerProjectId: string | null
  authMode: string | null
}

export interface ConnectRepoInput {
  provider: string
  repoUrl: string
  baseUrl?: string
  authMode?: string
  token?: string
  sshKey?: string
  defaultBranch?: string
}

export interface ReviewRequest {
  id?: number
  number: number
  title?: string
  state: string
  url: string
  head?: string
  base?: string
}

interface RawReviewRequest {
  id?: number
  number?: number
  title?: string
  state?: string
  url?: string
  html_url?: string
  head?: string | { ref?: string }
  base?: string | { ref?: string }
}

function providerQuery(provider?: string | null): string {
  return provider ? `?provider=${encodeURIComponent(provider)}` : ''
}

/**
 * Review URLs come from a provider, which may be a compromised self-hosted
 * instance. Only absolute http(s) URLs are exposed, and self-hosted rows must
 * stay on the connected provider origin; anything else becomes an empty string
 * so callers render text instead of a link.
 */
export function safeReviewUrl(rawUrl?: string | null, baseUrl?: string | null): string {
  if (!rawUrl) return ''
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return ''
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
  if (baseUrl) {
    let base: URL
    try {
      base = new URL(baseUrl)
    } catch {
      return ''
    }
    if (url.origin !== base.origin) return ''
  }
  return url.toString()
}

export function normalizeGitRepoStatus(raw: RawRepoStatus | null | undefined): GitRepoStatus | null {
  const base = normalizeRepoStatus(raw)
  if (!base) return null
  return {
    ...base,
    provider: raw?.provider || 'github',
    providerBaseUrl: raw?.providerBaseUrl ?? raw?.provider_base_url ?? null,
    providerProjectId: raw?.providerProjectId ?? raw?.provider_project_id ?? null,
    authMode: raw?.authMode ?? raw?.auth_mode ?? null,
  }
}

function normalizeReview(raw: RawReviewRequest, baseUrl?: string | null): ReviewRequest {
  return {
    id: raw.id,
    number: raw.number ?? 0,
    title: raw.title,
    state: raw.state ?? 'open',
    url: safeReviewUrl(raw.url || raw.html_url, baseUrl),
    head: typeof raw.head === 'string' ? raw.head : raw.head?.ref,
    base: typeof raw.base === 'string' ? raw.base : raw.base?.ref,
  }
}

export function listProviders(): Promise<GitCapabilities[]> {
  return get<GitCapabilities[]>('/api/v1/git/providers')
    .then((rows) => (Array.isArray(rows) ? rows : []))
    .catch(() => [])
}

export function getRepoStatus(
  projectId: string,
  provider?: string,
): Promise<GitRepoStatus | null> {
  return get<RawRepoStatus | null>(`/api/v1/git/${projectId}/repo${providerQuery(provider)}`)
    .then(normalizeGitRepoStatus)
    .catch(() => null)
}

export function listRepos(projectId: string): Promise<GitRepoStatus[]> {
  return get<RawRepoStatus[]>(`/api/v1/git/${projectId}/repos`)
    .then((rows) => (Array.isArray(rows) ? rows : [])
      .map(normalizeGitRepoStatus)
      .filter((row): row is GitRepoStatus => row !== null))
    .catch(() => [])
}

export function connectRepo(
  projectId: string,
  input: ConnectRepoInput,
): Promise<GitRepoStatus | null> {
  return post<RawRepoStatus>(`/api/v1/git/${projectId}/repo/connect`, input)
    .then(normalizeGitRepoStatus)
}

export function disconnectRepo(projectId: string, provider?: string): Promise<void> {
  return del<void>(`/api/v1/git/${projectId}/repo${providerQuery(provider)}`)
}

export function listBranches(projectId: string, provider?: string): Promise<Branch[]> {
  return get<Array<string | { name?: string }>>(
    `/api/v1/git/${projectId}/branches${providerQuery(provider)}`,
  )
    .then((rows) => (Array.isArray(rows) ? rows : [])
      .map((row) => (typeof row === 'string' ? row : row?.name || ''))
      .filter((name) => name.length > 0)
      .map((name) => ({ name, ticketId: ticketIdFromBranch(name) })))
    .catch(() => [])
}

export function createBranch(ticketId: string, provider?: string): Promise<{ branchName: string }> {
  return post<{ branchName: string }>(`/api/v1/git/${ticketId}/branch`, { provider })
}

export function deleteBranch(ticketId: string, provider?: string): Promise<void> {
  return del<void>(`/api/v1/git/${ticketId}/branch${providerQuery(provider)}`)
}

export function listReviews(
  projectId: string,
  provider?: string,
  baseUrl?: string | null,
): Promise<ReviewRequest[]> {
  return get<RawReviewRequest[]>(
    `/api/v1/git/${projectId}/reviews${providerQuery(provider)}`,
  )
    .then((rows) => (Array.isArray(rows)
      ? rows.map((row) => normalizeReview(row, baseUrl))
      : []))
    .catch(() => [])
}

export function createReview(
  ticketId: string,
  description: string,
  provider?: string,
  baseUrl?: string | null,
): Promise<ReviewRequest> {
  return post<RawReviewRequest>(`/api/v1/git/${ticketId}/review`, {
    description,
    ...(provider ? { provider } : {}),
  }).then((row) => normalizeReview(row, baseUrl))
}
