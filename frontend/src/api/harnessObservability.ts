import { get, post, put } from './client'

export interface HarnessRunSummary {
  total: number
  succeeded: number
  failed: number
  deadLetter: number
  budgetExceeded: number
  running: number
  successRate: number | null
  durationSeconds: { p50: number | null; p95: number | null }
}

export interface HarnessAlert {
  code: string
  severity: 'warning' | 'critical'
  message: string
  value?: number
  threshold?: number
  runIds?: string[]
}

export interface HarnessUsageModel {
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number
  toolCalls: number
  runs: number
}

export interface HarnessRunRow {
  id: string
  ticket_id: number | null
  ticket_title?: string | null
  status: string
  step?: string | null
  attempt?: number | null
  model?: string | null
  started_at: string
  finished_at?: string | null
  error?: string | null
  pr_url?: string | null
}

export interface HarnessDashboard {
  projectId: number
  period: { since: string; until: string }
  runs: HarnessRunSummary
  recentRuns: HarnessRunRow[]
  throughput: Array<{
    day: string
    runs: number
    succeeded: number
    failed: number
    budgetExceeded: number
  }>
  cost: {
    models: HarnessUsageModel[]
    totals: {
      inputTokens: number
      outputTokens: number
      cachedTokens: number
      costUsd: number
      toolCalls: number
    }
  }
  stuckRuns: Array<Record<string, unknown>>
  review: { reviewRounds: number; fixRounds: number }
  toolCalls: { total: number; failed: number }
  secretScan: { flaggedEvents: number }
  budget: {
    dailySpendUsd: number
    dailyLimitUsd: number
    killSwitch: HarnessKillSwitch | null
    routing: {
      policy: string
      freeModel: string | null
      paidModel: string | null
      complexityThreshold: number
    }
    limits: Record<string, number>
  }
  merge: null
  rollback: null
  alerts: HarnessAlert[]
}

export interface HarnessBudgetPolicy {
  projectId: number
  source: string
  limits: {
    maxDurationSeconds: number
    maxInputTokens: number
    maxOutputTokens: number
    maxCostUsd: number
    maxToolCalls: number
    maxRetries: number
    warnRatio: number
  }
  quotas: {
    dailyCostUsd: number
    projectMaxConcurrentRuns: number
    agentMaxConcurrentRuns: number
  }
  routing: {
    policy: string
    freeModel: string | null
    paidModel: string | null
    complexityThreshold: number
  }
  dailySpendUsd: number
  killSwitch: HarnessKillSwitch | null
}

export interface HarnessKillSwitch {
  scope: 'global' | 'project'
  project_id?: number | null
  enabled: boolean
  reason?: string | null
}

export interface HarnessEvent {
  event_id: string
  trace_id: string
  run_id: string | null
  ticket_id: number | null
  project_id: number
  agent_id: number | null
  session_id: string | null
  type: string
  version: number
  payload: Record<string, unknown>
  created_at: string
}

export interface HarnessTimeline {
  run: Record<string, unknown>
  traceId: string | null
  events: HarnessEvent[]
  checkpoints: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
  verificationCommands: string[]
  diff: Record<string, unknown> | null
  promptSummary: Record<string, unknown> | null
  replayable: boolean
  truncated: boolean
}

export interface HarnessKillSwitchAudit {
  id: number
  scope: 'global' | 'project'
  project_id: number | null
  enabled: boolean
  reason: string | null
  actor_id: number | null
  created_at: string
}

export type HarnessDataClass = 'public' | 'internal' | 'confidential' | 'secret'

export interface HarnessPrivacyPolicy {
  projectId: number | null
  source: string
  maxDataClass: HarnessDataClass
  allowedProviders: string[]
  requireNoTraining: boolean
  localOnly: boolean
  localEndpoint: string | null
  localModel: string | null
  dataResidency: string | null
  blockOnSecret: boolean
  blockOnPii: boolean
  redactPii: boolean
  eventRetentionDays: number
  artifactRetentionDays: number
  policyVersion: number
  updatedAt: string | null
}

export interface HarnessPrivacyDeleteResult {
  events: number
  usage: number
  messages: number
  checkpoints: number
  runs: number
  usageLogs: number
}

export interface HarnessPrivacyExport {
  projectId: number
  exportedAt: string
  policy: HarnessPrivacyPolicy
  events: HarnessEvent[]
  usage: Array<Record<string, unknown>>
  runs: Array<Record<string, unknown>>
  checkpoints: Array<Record<string, unknown>>
  messages: Array<Record<string, unknown>>
  usageLogs: Array<Record<string, unknown>>
  hasMore: boolean
  nextOffset: number | null
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value)
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}

export function getHarnessDashboard(
  projectId: number | string,
  params: { since?: string; until?: string } = {}
): Promise<HarnessDashboard> {
  return get<HarnessDashboard>(
    `/api/v1/harness/projects/${projectId}/dashboard${query(params)}`
  )
}

export function getHarnessBudgetPolicy(
  projectId: number | string
): Promise<HarnessBudgetPolicy> {
  return get<HarnessBudgetPolicy>(`/api/v1/harness/projects/${projectId}/budget-policy`)
}

export function updateHarnessBudgetPolicy(
  projectId: number | string,
  policy: Record<string, unknown>
): Promise<HarnessBudgetPolicy> {
  return put<HarnessBudgetPolicy>(
    `/api/v1/harness/projects/${projectId}/budget-policy`,
    policy
  )
}

export function getHarnessKillSwitch(
  projectId: number | string
): Promise<HarnessKillSwitch | null> {
  return get<HarnessKillSwitch | null>(
    `/api/v1/harness/projects/${projectId}/kill-switch`
  )
}

export function updateHarnessKillSwitch(
  projectId: number | string,
  enabled: boolean,
  reason?: string
): Promise<HarnessKillSwitch> {
  return put<HarnessKillSwitch>(`/api/v1/harness/projects/${projectId}/kill-switch`, {
    enabled,
    reason,
  })
}

export function getHarnessKillSwitchAudit(
  projectId: number | string,
  params: { limit?: string } = {}
): Promise<HarnessKillSwitchAudit[]> {
  return get<HarnessKillSwitchAudit[]>(
    `/api/v1/harness/projects/${projectId}/kill-switch/audit${query(params)}`
  )
}

export function getHarnessTimeline(runId: string): Promise<HarnessTimeline> {
  return get<HarnessTimeline>(`/api/v1/harness/runs/${runId}/timeline`)
}

export function getHarnessProjectEvents(
  projectId: number | string,
  params: { type?: string; since?: string; until?: string; limit?: string; offset?: string } = {}
): Promise<HarnessEvent[]> {
  return get<HarnessEvent[]>(
    `/api/v1/harness/projects/${projectId}/events${query(params)}`
  )
}

export function getHarnessAudit(
  projectId: number | string,
  params: { since?: string; until?: string; limit?: string; offset?: string } = {}
): Promise<HarnessEvent[]> {
  return get<HarnessEvent[]>(
    `/api/v1/harness/projects/${projectId}/audit${query(params)}`
  )
}

export function getHarnessPrivacyPolicy(
  projectId: number | string
): Promise<HarnessPrivacyPolicy> {
  return get<HarnessPrivacyPolicy>(
    `/api/v1/harness/projects/${projectId}/privacy-policy`
  )
}

export function updateHarnessPrivacyPolicy(
  projectId: number | string,
  policy: Record<string, unknown>
): Promise<HarnessPrivacyPolicy> {
  return put<HarnessPrivacyPolicy>(
    `/api/v1/harness/projects/${projectId}/privacy-policy`,
    policy
  )
}

export function deleteHarnessProjectData(
  projectId: number | string,
  payload: { dataClasses?: string[]; before?: string | null; reason?: string | null }
): Promise<HarnessPrivacyDeleteResult> {
  return post<HarnessPrivacyDeleteResult>(
    `/api/v1/harness/projects/${projectId}/privacy/delete`,
    payload
  )
}

export function exportHarnessProjectData(
  projectId: number | string,
  params: { limit?: string; offset?: string } = {}
): Promise<HarnessPrivacyExport> {
  return get<HarnessPrivacyExport>(
    `/api/v1/harness/projects/${projectId}/privacy/export${query(params)}`
  )
}
