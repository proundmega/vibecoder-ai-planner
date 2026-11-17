import { get, post, put } from './client'

export interface RepoServiceHealthcheck {
  command: string
  interval_seconds: number
  timeout_seconds: number
  retries: number
  start_period_seconds?: number
}

export interface RepoService {
  name: string
  image: string
  env: Record<string, string>
  password_env?: string
  connection_env: string
  connection_url: string
  healthcheck: RepoServiceHealthcheck
}

export interface RepoEgress {
  tls_mode?: 'terminate'
  origin_ca_hosts?: string[]
  origin_ca_b64?: string
  mtls?: { credential_id: number; hosts: string[] }
}

export interface RepoProfile {
  schema_version?: number
  repo_url?: string
  base_branch?: string
  languages: string[]
  image?: string
  setup: string[]
  verify: string[]
  caches: string[]
  env: Record<string, string>
  timeouts: { setup_minutes: number; verify_minutes: number }
  max_round_minutes: number
  services: RepoService[]
  flaky_tests: string[]
  egress?: RepoEgress
}

export interface RepoProfileRow {
  id: string
  project_id: string
  version: number
  profile: RepoProfile
  profile_hash: string | null
  status: 'draft' | 'active' | 'inactive'
  created_by?: string | null
  created_at?: string
  updated_at?: string
  activated_at?: string | null
}

export interface RepoProfileCurrent {
  active: RepoProfileRow | null
  latest: RepoProfileRow | null
  versions: RepoProfileRow[]
}

export interface RepoProfileValidation {
  id: string
  project_id: string
  profile_id: string
  profile_version: number
  profile: RepoProfile
  profile_hash: string | null
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  result?: Record<string, unknown>
  error?: string | null
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
}

export interface RepoProfileDetection {
  detected: boolean
  profile: RepoProfile
  warnings: string[]
}

export function getRepoProfile(projectId: string): Promise<RepoProfileCurrent> {
  return get<RepoProfileCurrent>(`/api/v1/projects/${projectId}/repo-profile`)
}

export function listRepoProfileVersions(projectId: string): Promise<RepoProfileRow[]> {
  return get<RepoProfileRow[]>(`/api/v1/projects/${projectId}/repo-profile/versions`)
}

export function createRepoProfile(projectId: string, profile: RepoProfile): Promise<RepoProfileRow> {
  return post<RepoProfileRow>(`/api/v1/projects/${projectId}/repo-profile`, profile)
}

export function updateRepoProfile(
  projectId: string,
  profileId: string,
  profile: RepoProfile,
): Promise<RepoProfileRow> {
  return put<RepoProfileRow>(
    `/api/v1/projects/${projectId}/repo-profile/${profileId}`,
    profile,
  )
}

export function detectRepoProfile(projectId: string): Promise<RepoProfileDetection> {
  return post<RepoProfileDetection>(
    `/api/v1/projects/${projectId}/repo-profile/detect`,
    {},
  )
}

export function activateRepoProfile(projectId: string, profileId: string): Promise<RepoProfileRow> {
  return post<RepoProfileRow>(
    `/api/v1/projects/${projectId}/repo-profile/${profileId}/activate`,
    {},
  )
}

export function requestProfileValidation(
  projectId: string,
  profileId: string,
): Promise<RepoProfileValidation> {
  return post<RepoProfileValidation>(
    `/api/v1/projects/${projectId}/repo-profile/${profileId}/validate`,
    {},
  )
}

export function listProfileValidations(projectId: string): Promise<RepoProfileValidation[]> {
  return get<RepoProfileValidation[]>(
    `/api/v1/projects/${projectId}/repo-profile/validations`,
  )
}

export function getProfileValidation(
  projectId: string,
  validationId: string,
): Promise<RepoProfileValidation> {
  return get<RepoProfileValidation>(
    `/api/v1/projects/${projectId}/repo-profile/validations/${validationId}`,
  )
}
