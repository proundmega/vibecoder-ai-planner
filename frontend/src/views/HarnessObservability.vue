<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import {
  deleteHarnessProjectData,
  exportHarnessProjectData,
  getHarnessAudit,
  getHarnessBudgetPolicy,
  getHarnessDashboard,
  getHarnessKillSwitchAudit,
  getHarnessPrivacyPolicy,
  getHarnessTimeline,
  updateHarnessBudgetPolicy,
  updateHarnessKillSwitch,
  updateHarnessPrivacyPolicy,
  type HarnessBudgetPolicy,
  type HarnessDashboard,
  type HarnessEvent,
  type HarnessKillSwitchAudit,
  type HarnessPrivacyPolicy,
  type HarnessRunRow,
  type HarnessTimeline,
} from '@/api/harnessObservability'

const route = useRoute()
const projectId = computed(() => String(route.params.id || ''))

const loading = ref(true)
const error = ref<string | null>(null)
const dashboard = ref<HarnessDashboard | null>(null)
const policy = ref<HarnessBudgetPolicy | null>(null)
const privacy = ref<HarnessPrivacyPolicy | null>(null)
const audit = ref<HarnessEvent[]>([])
const killSwitchAudit = ref<HarnessKillSwitchAudit[]>([])
const timeline = ref<HarnessTimeline | null>(null)
const runId = ref('')
const timelineLoading = ref(false)
const timelineError = ref<string | null>(null)
const savingPolicy = ref(false)
const savingKillSwitch = ref(false)
const savingPrivacy = ref(false)
const exportingPrivacy = ref(false)
const privacyStatus = ref<string | null>(null)
const privacyDeleteBefore = ref('')

const policyForm = ref({
  maxDurationSeconds: 2700,
  maxInputTokens: 1200000,
  maxOutputTokens: 300000,
  maxCostUsd: 5,
  maxToolCalls: 100,
  maxRetries: 2,
  dailyCostUsd: 20,
  projectMaxConcurrentRuns: 4,
  agentMaxConcurrentRuns: 1,
  warnRatio: 0.8,
  routingPolicy: 'free_then_paid',
  freeModel: 'beam-free',
  paidModel: '',
  complexityThreshold: 3,
})

const privacyForm = ref({
  maxDataClass: 'confidential' as HarnessPrivacyPolicy['maxDataClass'],
  allowedProviders: '',
  requireNoTraining: false,
  localOnly: false,
  localEndpoint: '',
  localModel: '',
  dataResidency: '',
  blockOnSecret: false,
  blockOnPii: false,
  redactPii: true,
  eventRetentionDays: 30,
  artifactRetentionDays: 7,
})

const successRate = computed(() => {
  const value = dashboard.value?.runs.successRate
  return value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`
})

const p50 = computed(() => formatDuration(dashboard.value?.runs.durationSeconds.p50))
const p95 = computed(() => formatDuration(dashboard.value?.runs.durationSeconds.p95))
const totalCost = computed(() =>
  `$${(dashboard.value?.cost.totals.costUsd || 0).toFixed(4)}`)
const killSwitchEnabled = computed(() => Boolean(dashboard.value?.budget.killSwitch?.enabled))
const activeKillSwitch = computed(() => dashboard.value?.budget.killSwitch || null)
const globalKillSwitchEnabled = computed(() => activeKillSwitch.value?.scope === 'global')
const projectKillSwitchEnabled = computed(
  () => activeKillSwitch.value?.scope === 'project'
)

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes}m ${Math.round(seconds % 60)}s`
}

function formatTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function payloadPreview(payload: Record<string, unknown>): string {
  const text = JSON.stringify(payload)
  return text.length > 180 ? `${text.slice(0, 180)}…` : text
}

function auditActor(event: HarnessEvent): string {
  const actor = event.payload?.actor
  if (actor && typeof actor === 'object' && 'type' in actor) {
    return String((actor as Record<string, unknown>).type)
  }
  return '—'
}

function auditDetail(event: HarnessEvent): string {
  const payload = event.payload || {}
  for (const key of ['reason', 'afterSha', 'prUrl']) {
    const value = payload[key]
    if (value !== undefined && value !== null && String(value) !== '') {
      return String(value)
    }
  }
  return '—'
}

function applyPolicyForm(value: HarnessBudgetPolicy): void {
  policyForm.value = {
    maxDurationSeconds: value.limits.maxDurationSeconds,
    maxInputTokens: value.limits.maxInputTokens,
    maxOutputTokens: value.limits.maxOutputTokens,
    maxCostUsd: value.limits.maxCostUsd,
    maxToolCalls: value.limits.maxToolCalls,
    maxRetries: value.limits.maxRetries,
    dailyCostUsd: value.quotas.dailyCostUsd,
    projectMaxConcurrentRuns: value.quotas.projectMaxConcurrentRuns,
    agentMaxConcurrentRuns: value.quotas.agentMaxConcurrentRuns,
    warnRatio: value.limits.warnRatio,
    routingPolicy: value.routing.policy,
    freeModel: value.routing.freeModel || '',
    paidModel: value.routing.paidModel || '',
    complexityThreshold: value.routing.complexityThreshold,
  }
}

function applyPrivacyForm(value: HarnessPrivacyPolicy): void {
  privacyForm.value = {
    maxDataClass: value.maxDataClass,
    allowedProviders: (value.allowedProviders || []).join(', '),
    requireNoTraining: value.requireNoTraining,
    localOnly: value.localOnly,
    localEndpoint: value.localEndpoint || '',
    localModel: value.localModel || '',
    dataResidency: value.dataResidency || '',
    blockOnSecret: value.blockOnSecret,
    blockOnPii: value.blockOnPii,
    redactPii: value.redactPii,
    eventRetentionDays: value.eventRetentionDays,
    artifactRetentionDays: value.artifactRetentionDays,
  }
}

async function loadDashboard(): Promise<void> {
  if (!projectId.value) return
  dashboard.value = await getHarnessDashboard(projectId.value)
}

async function loadPolicy(): Promise<void> {
  if (!projectId.value) return
  policy.value = await getHarnessBudgetPolicy(projectId.value)
  applyPolicyForm(policy.value)
}

async function loadPrivacy(): Promise<void> {
  if (!projectId.value) return
  privacy.value = await getHarnessPrivacyPolicy(projectId.value)
  applyPrivacyForm(privacy.value)
}

async function loadAudit(): Promise<void> {
  if (!projectId.value) return
  const [events, switches] = await Promise.all([
    getHarnessAudit(projectId.value, { limit: '50' }),
    getHarnessKillSwitchAudit(projectId.value, { limit: '50' }),
  ])
  audit.value = events
  killSwitchAudit.value = switches
}

async function loadAll(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    await Promise.all([loadDashboard(), loadPolicy(), loadPrivacy(), loadAudit()])
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load harness observability'
  } finally {
    loading.value = false
  }
}

async function savePolicy(): Promise<void> {
  if (!projectId.value) return
  savingPolicy.value = true
  try {
    policy.value = await updateHarnessBudgetPolicy(projectId.value, {
      ...policyForm.value,
      paidModel: policyForm.value.paidModel || null,
      freeModel: policyForm.value.freeModel || null,
    })
    applyPolicyForm(policy.value)
    await loadDashboard()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save policy'
  } finally {
    savingPolicy.value = false
  }
}

async function savePrivacy(): Promise<void> {
  if (!projectId.value) return
  savingPrivacy.value = true
  privacyStatus.value = null
  try {
    privacy.value = await updateHarnessPrivacyPolicy(projectId.value, {
      maxDataClass: privacyForm.value.maxDataClass,
      allowedProviders: privacyForm.value.allowedProviders
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
      requireNoTraining: privacyForm.value.requireNoTraining,
      localOnly: privacyForm.value.localOnly,
      localEndpoint: privacyForm.value.localEndpoint || null,
      localModel: privacyForm.value.localModel || null,
      dataResidency: privacyForm.value.dataResidency || null,
      blockOnSecret: privacyForm.value.blockOnSecret,
      blockOnPii: privacyForm.value.blockOnPii,
      redactPii: privacyForm.value.redactPii,
      eventRetentionDays: privacyForm.value.eventRetentionDays,
      artifactRetentionDays: privacyForm.value.artifactRetentionDays,
    })
    applyPrivacyForm(privacy.value)
    privacyStatus.value = `Saved policy v${privacy.value.policyVersion}.`
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to save privacy policy'
  } finally {
    savingPrivacy.value = false
  }
}

async function deleteProjectData(): Promise<void> {
  if (!projectId.value) return
  const scope = privacyDeleteBefore.value ? 'older data' : 'all stored run data'
  if (!window.confirm(`Delete ${scope} for this project? Audit records are kept.`)) {
    return
  }
  privacyStatus.value = null
  try {
    const result = await deleteHarnessProjectData(projectId.value, {
      dataClasses: ['events', 'usage'],
      before: privacyDeleteBefore.value || null,
      reason: 'operator deletion from harness dashboard',
    })
    privacyStatus.value =
      `Deleted ${result.events} event(s) and ${result.usage} usage row(s).`
    await Promise.all([loadDashboard(), loadAudit()])
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to delete project data'
  }
}

async function exportProjectData(): Promise<void> {
  if (!projectId.value) return
  exportingPrivacy.value = true
  privacyStatus.value = null
  try {
    const data = await exportHarnessProjectData(projectId.value)
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `harness-privacy-export-${data.projectId}.json`
    link.click()
    URL.revokeObjectURL(url)
    privacyStatus.value =
      `Exported ${data.events.length} event(s), ${data.usage.length} usage row(s) ` +
      `and ${data.runs.length} run(s).`
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to export project data'
  } finally {
    exportingPrivacy.value = false
  }
}

async function toggleKillSwitch(): Promise<void> {
  if (!projectId.value) return
  savingKillSwitch.value = true
  try {
    const enabling = !projectKillSwitchEnabled.value
    await updateHarnessKillSwitch(
      projectId.value,
      enabling,
      enabling
        ? 'enabled from harness dashboard'
        : 'disabled from harness dashboard'
    )
    await loadDashboard()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to update kill switch'
  } finally {
    savingKillSwitch.value = false
  }
}

async function loadTimeline(): Promise<void> {
  if (!runId.value.trim()) return
  timelineLoading.value = true
  timelineError.value = null
  try {
    timeline.value = await getHarnessTimeline(runId.value.trim())
  } catch (err) {
    timeline.value = null
    timelineError.value = err instanceof Error ? err.message : 'Failed to load timeline'
  } finally {
    timelineLoading.value = false
  }
}

async function replayRun(run: HarnessRunRow): Promise<void> {
  runId.value = run.id
  await loadTimeline()
}

onMounted(loadAll)
watch(projectId, loadAll)
</script>

<template>
  <div class="harness-observability">
    <header class="page-header">
      <div>
        <h1>Harness Observability</h1>
        <p class="subtitle">
          Run timeline, budgets, alerts and immutable publish/review audit for this project.
        </p>
      </div>
      <button class="btn-secondary" :disabled="loading" @click="loadAll">
        Refresh
      </button>
    </header>

    <div v-if="loading" class="loading">Loading harness data…</div>
    <div v-else-if="error" class="error">
      <p>{{ error }}</p>
    </div>

    <template v-else-if="dashboard">
      <section class="summary-grid">
        <article class="summary-card">
          <span class="summary-label">Runs</span>
          <strong class="summary-value">{{ dashboard.runs.total }}</strong>
          <span class="summary-meta">
            {{ dashboard.runs.succeeded }} succeeded · {{ dashboard.runs.failed }} failed
          </span>
        </article>
        <article class="summary-card">
          <span class="summary-label">Success rate</span>
          <strong class="summary-value">{{ successRate }}</strong>
          <span class="summary-meta">{{ dashboard.runs.running }} running</span>
        </article>
        <article class="summary-card">
          <span class="summary-label">p50 / p95 duration</span>
          <strong class="summary-value">{{ p50 }} / {{ p95 }}</strong>
          <span class="summary-meta">terminal runs in period</span>
        </article>
        <article class="summary-card">
          <span class="summary-label">Cost</span>
          <strong class="summary-value">{{ totalCost }}</strong>
          <span class="summary-meta">
            {{ dashboard.cost.totals.inputTokens.toLocaleString() }} in ·
            {{ dashboard.cost.totals.outputTokens.toLocaleString() }} out
          </span>
        </article>
        <article class="summary-card">
          <span class="summary-label">Review / fix rounds</span>
          <strong class="summary-value">
            {{ dashboard.review.reviewRounds }} / {{ dashboard.review.fixRounds }}
          </strong>
          <span class="summary-meta">
            {{ dashboard.toolCalls.failed }} failed tool call(s)
          </span>
        </article>
        <article class="summary-card">
          <span class="summary-label">Stuck runs</span>
          <strong class="summary-value">{{ dashboard.stuckRuns.length }}</strong>
          <span class="summary-meta">
            {{ dashboard.secretScan.flaggedEvents }} secret-scan hit(s)
          </span>
        </article>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Alerts</h2>
          <span class="badge" :class="{ danger: killSwitchEnabled }">
            {{ globalKillSwitchEnabled
              ? 'Global kill switch ON'
              : `Project kill switch ${projectKillSwitchEnabled ? 'ON' : 'off'}` }}
          </span>
        </div>
        <p v-if="dashboard.alerts.length === 0" class="muted">No active alerts.</p>
        <ul v-else class="alerts">
          <li
            v-for="alert in dashboard.alerts"
            :key="alert.code"
            :class="['alert', alert.severity]"
          >
            <strong>{{ alert.code }}</strong>
            <span>{{ alert.message }}</span>
          </li>
        </ul>
        <button
          class="btn-secondary"
          :disabled="savingKillSwitch || globalKillSwitchEnabled"
          @click="toggleKillSwitch"
        >
          {{ globalKillSwitchEnabled
            ? 'Global kill switch is active'
            : (projectKillSwitchEnabled
              ? 'Disable project kill switch'
              : 'Enable project kill switch') }}
        </button>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Cost by model</h2>
          <span class="muted">
            Daily spend ${{ dashboard.budget.dailySpendUsd.toFixed(2) }} /
            ${{ dashboard.budget.dailyLimitUsd.toFixed(2) }}
          </span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Runs</th>
              <th>Input</th>
              <th>Output</th>
              <th>Cached</th>
              <th>Tool calls</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in dashboard.cost.models" :key="row.model">
              <td>{{ row.model }}</td>
              <td>{{ row.runs }}</td>
              <td>{{ row.inputTokens.toLocaleString() }}</td>
              <td>{{ row.outputTokens.toLocaleString() }}</td>
              <td>{{ row.cachedTokens.toLocaleString() }}</td>
              <td>{{ row.toolCalls }}</td>
              <td>${{ row.costUsd.toFixed(4) }}</td>
            </tr>
            <tr v-if="dashboard.cost.models.length === 0">
              <td colspan="7" class="muted">No usage recorded in this period.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Budget &amp; routing policy</h2>
        </div>
        <form class="policy-grid" @submit.prevent="savePolicy">
          <label>
            <span>Max duration (seconds)</span>
            <input v-model.number="policyForm.maxDurationSeconds" type="number" min="1" />
          </label>
          <label>
            <span>Max input tokens</span>
            <input v-model.number="policyForm.maxInputTokens" type="number" min="0" />
          </label>
          <label>
            <span>Max output tokens</span>
            <input v-model.number="policyForm.maxOutputTokens" type="number" min="0" />
          </label>
          <label>
            <span>Max cost (USD)</span>
            <input v-model.number="policyForm.maxCostUsd" type="number" min="0" step="0.01" />
          </label>
          <label>
            <span>Max tool calls</span>
            <input v-model.number="policyForm.maxToolCalls" type="number" min="0" />
          </label>
          <label>
            <span>Max retries</span>
            <input v-model.number="policyForm.maxRetries" type="number" min="0" />
          </label>
          <label>
            <span>Daily cost limit (USD)</span>
            <input v-model.number="policyForm.dailyCostUsd" type="number" min="0" step="0.01" />
          </label>
          <label>
            <span>Project concurrency</span>
            <input v-model.number="policyForm.projectMaxConcurrentRuns" type="number" min="1" />
          </label>
          <label>
            <span>Agent concurrency</span>
            <input v-model.number="policyForm.agentMaxConcurrentRuns" type="number" min="1" />
          </label>
          <label>
            <span>Warn ratio</span>
            <input v-model.number="policyForm.warnRatio" type="number" min="0.1" max="1" step="0.05" />
          </label>
          <label>
            <span>Routing policy</span>
            <select v-model="policyForm.routingPolicy">
              <option value="free_only">free_only</option>
              <option value="free_then_paid">free_then_paid</option>
              <option value="paid_for_complex">paid_for_complex</option>
              <option value="paid_only">paid_only</option>
            </select>
          </label>
          <label>
            <span>Free model</span>
            <input v-model="policyForm.freeModel" type="text" />
          </label>
          <label>
            <span>Paid model</span>
            <input v-model="policyForm.paidModel" type="text" placeholder="optional" />
          </label>
          <label>
            <span>Complexity threshold</span>
            <input v-model.number="policyForm.complexityThreshold" type="number" min="0" />
          </label>
          <div class="policy-actions">
            <button type="submit" class="btn-primary" :disabled="savingPolicy">
              {{ savingPolicy ? 'Saving…' : 'Save policy' }}
            </button>
            <span v-if="policy" class="muted">Source: {{ policy.source }}</span>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Privacy &amp; data governance</h2>
          <span v-if="privacy" class="badge">{{ privacy.maxDataClass }}</span>
          <span v-if="privacy" class="muted">
            {{ privacy.source }} policy · v{{ privacy.policyVersion }}
          </span>
        </div>
        <form class="policy-grid" @submit.prevent="savePrivacy">
          <label>
            <span>Max data class</span>
            <select v-model="privacyForm.maxDataClass">
              <option value="public">public</option>
              <option value="internal">internal</option>
              <option value="confidential">confidential</option>
              <option value="secret">secret (local model only)</option>
            </select>
          </label>
          <label>
            <span>Allowed providers</span>
            <input
              v-model="privacyForm.allowedProviders"
              type="text"
              placeholder="comma separated; empty = no allowlist"
            />
          </label>
          <label>
            <span>Local endpoint</span>
            <input
              v-model="privacyForm.localEndpoint"
              type="url"
              placeholder="http://ollama:11434/v1"
            />
          </label>
          <label>
            <span>Local model</span>
            <input v-model="privacyForm.localModel" type="text" placeholder="optional" />
          </label>
          <label>
            <span>Data residency</span>
            <input v-model="privacyForm.dataResidency" type="text" placeholder="e.g. eu" />
          </label>
          <label>
            <span>Event retention (days)</span>
            <input
              v-model.number="privacyForm.eventRetentionDays"
              type="number"
              min="1"
              max="3650"
            />
          </label>
          <label>
            <span>Artifact retention (days)</span>
            <input
              v-model.number="privacyForm.artifactRetentionDays"
              type="number"
              min="1"
              max="3650"
            />
          </label>
          <label class="checkbox-label">
            <input v-model="privacyForm.redactPii" type="checkbox" />
            <span>Redact PII patterns</span>
          </label>
          <label class="checkbox-label">
            <input v-model="privacyForm.blockOnSecret" type="checkbox" />
            <span>Block on secret pattern</span>
          </label>
          <label class="checkbox-label">
            <input v-model="privacyForm.blockOnPii" type="checkbox" />
            <span>Block on PII pattern</span>
          </label>
          <label class="checkbox-label">
            <input v-model="privacyForm.requireNoTraining" type="checkbox" />
            <span>Require no-training attestation</span>
          </label>
          <label class="checkbox-label">
            <input v-model="privacyForm.localOnly" type="checkbox" />
            <span>Local/self-hosted model only</span>
          </label>
          <div class="policy-actions">
            <button type="submit" class="btn-primary" :disabled="savingPrivacy">
              {{ savingPrivacy ? 'Saving…' : 'Save privacy policy' }}
            </button>
          </div>
        </form>
        <div class="privacy-actions">
          <label class="privacy-delete">
            <span>Delete data before (optional)</span>
            <input v-model="privacyDeleteBefore" type="datetime-local" />
          </label>
          <button
            class="btn-secondary"
            :disabled="exportingPrivacy"
            @click="exportProjectData"
          >
            {{ exportingPrivacy ? 'Exporting…' : 'Export project data' }}
          </button>
          <button class="btn-secondary" @click="deleteProjectData">
            Delete stored data
          </button>
        </div>
        <p v-if="privacyStatus" class="muted">{{ privacyStatus }}</p>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Recent runs</h2>
          <span class="muted">Open a run to reconstruct its replay timeline.</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Ticket</th>
              <th>Status</th>
              <th>Step</th>
              <th>Model</th>
              <th>Started</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="run in dashboard.recentRuns" :key="run.id">
              <td class="mono">{{ run.id }}</td>
              <td>{{ run.ticket_title || run.ticket_id || '—' }}</td>
              <td>{{ run.status }}</td>
              <td>{{ run.step || '—' }}</td>
              <td>{{ run.model || '—' }}</td>
              <td>{{ formatTime(run.started_at) }}</td>
              <td>
                <button class="link-button" @click="replayRun(run)">Replay</button>
              </td>
            </tr>
            <tr v-if="dashboard.recentRuns.length === 0">
              <td colspan="7" class="muted">No runs in this period.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Replay timeline</h2>
          <span class="muted">Enter a harness run id to reconstruct the ordered timeline.</span>
        </div>
        <form class="timeline-form" @submit.prevent="loadTimeline">
          <input v-model="runId" type="text" placeholder="run UUID" />
          <button type="submit" class="btn-secondary" :disabled="timelineLoading">
            {{ timelineLoading ? 'Loading…' : 'Load timeline' }}
          </button>
        </form>
        <p v-if="timelineError" class="error">{{ timelineError }}</p>
        <template v-if="timeline">
          <p class="muted">
            Trace {{ timeline.traceId || '—' }} ·
            {{ timeline.events.length }} event(s) ·
            {{ timeline.replayable ? 'replayable' : 'still running' }}
          </p>
          <p v-if="timeline.truncated" class="warning">
            Timeline truncated at the event limit; use newer pagination or a narrower
            window to see the rest.
          </p>
          <ol class="timeline">
            <li v-for="event in timeline.events" :key="event.event_id">
              <span class="timeline-type">{{ event.type }}</span>
              <span class="timeline-time">{{ formatTime(event.created_at) }}</span>
              <code>{{ payloadPreview(event.payload) }}</code>
            </li>
          </ol>
          <div v-if="timeline.verificationCommands.length" class="artifacts">
            <h3>Re-run verification without the model</h3>
            <code v-for="command in timeline.verificationCommands" :key="command">
              {{ command }}
            </code>
          </div>
        </template>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Kill-switch history</h2>
          <span class="muted">Append-only kill-switch audit.</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Scope</th>
              <th>State</th>
              <th>Reason</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in killSwitchAudit" :key="row.id">
              <td>{{ formatTime(row.created_at) }}</td>
              <td>{{ row.scope }}</td>
              <td>{{ row.enabled ? 'enabled' : 'disabled' }}</td>
              <td>{{ row.reason || '—' }}</td>
              <td>{{ row.actor_id || '—' }}</td>
            </tr>
            <tr v-if="killSwitchAudit.length === 0">
              <td colspan="5" class="muted">No kill-switch changes yet.</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Publish / review audit</h2>
          <span class="muted">Append-only audit records.</span>
        </div>
        <table class="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Type</th>
              <th>Run</th>
              <th>Actor</th>
              <th>Reason / evidence</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="event in audit" :key="event.event_id">
              <td>{{ formatTime(event.created_at) }}</td>
              <td>{{ event.type }}</td>
              <td class="mono">{{ event.run_id || '—' }}</td>
              <td>{{ auditActor(event) }}</td>
              <td>{{ auditDetail(event) }}</td>
            </tr>
            <tr v-if="audit.length === 0">
              <td colspan="5" class="muted">No audit records yet.</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </div>
</template>

<style scoped>
.harness-observability {
  padding: 24px;
  max-width: 1280px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 24px;
}

h1 {
  margin: 0 0 6px;
  font-size: 28px;
  color: #1f2937;
}

.subtitle,
.muted {
  color: #6b7280;
  margin: 0;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
}

.error {
  color: #dc2626;
}

.warning {
  color: #b45309;
  background: #fffbeb;
  border-radius: 6px;
  padding: 8px 10px;
}

.summary-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 16px;
  margin-bottom: 24px;
}

.summary-card,
.panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
}

.summary-card {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.summary-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #6b7280;
}

.summary-value {
  font-size: 24px;
  color: #111827;
}

.summary-meta {
  font-size: 13px;
  color: #6b7280;
}

.panel {
  padding: 20px;
  margin-bottom: 24px;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 14px;
}

.panel-header h2 {
  margin: 0;
  font-size: 18px;
  color: #1f2937;
}

.badge {
  border-radius: 999px;
  padding: 4px 10px;
  background: #ecfdf5;
  color: #047857;
  font-size: 12px;
  font-weight: 600;
}

.badge.danger {
  background: #fef2f2;
  color: #b91c1c;
}

.alerts {
  list-style: none;
  padding: 0;
  margin: 0 0 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.alert {
  display: flex;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  background: #fffbeb;
  color: #92400e;
}

.alert.critical {
  background: #fef2f2;
  color: #b91c1c;
}

.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.data-table th,
.data-table td {
  text-align: left;
  padding: 8px 10px;
  border-bottom: 1px solid #f3f4f6;
}

.data-table th {
  color: #6b7280;
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.policy-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

.policy-grid label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #374151;
}

.policy-grid input,
.policy-grid select,
.timeline-form input {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.policy-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.checkbox-label {
  flex-direction: row !important;
  align-items: center;
  gap: 8px !important;
}

.checkbox-label input {
  width: auto;
}

.privacy-actions {
  display: flex;
  align-items: flex-end;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #e5e7eb;
}

.privacy-delete {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 13px;
  color: #374151;
}

.privacy-delete input {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.timeline-form {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}

.timeline-form input {
  flex: 1;
}

.timeline {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.timeline li {
  display: grid;
  grid-template-columns: 180px 170px 1fr;
  gap: 10px;
  align-items: start;
  padding: 8px 10px;
  background: #f9fafb;
  border-radius: 6px;
}

.timeline-type {
  font-weight: 600;
  color: #111827;
}

.timeline-time,
.mono {
  color: #6b7280;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  word-break: break-all;
}

.artifacts {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.btn-primary,
.btn-secondary {
  border-radius: 6px;
  padding: 8px 14px;
  font-size: 14px;
  cursor: pointer;
}

.btn-primary {
  background: #2563eb;
  color: #fff;
  border: 1px solid #2563eb;
}

.btn-secondary {
  background: #fff;
  color: #374151;
  border: 1px solid #d1d5db;
}

.btn-primary:disabled,
.btn-secondary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.link-button {
  background: none;
  border: none;
  color: #2563eb;
  cursor: pointer;
  padding: 0;
  font-size: 14px;
}
</style>
