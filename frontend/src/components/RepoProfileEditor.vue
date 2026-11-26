<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { fetchProjectById, type Project } from '@/api/projects'
import {
  activateRepoProfile,
  createRepoProfile,
  detectRepoProfile,
  getProfileValidation,
  getRepoProfile,
  listProfileValidations,
  requestProfileValidation,
  updateRepoProfile,
  type RepoProfile,
  type RepoProfileCurrent,
  type RepoProfileRow,
  type RepoProfileValidation,
  type RepoService,
} from '@/api/repoProfiles'
import { useAuthStore } from '@/stores/auth'

const props = defineProps<{ projectId: string }>()
const VALIDATION_PAGE_SIZE = 200

interface EnvRow { key: string; value: string }
interface ServiceRow {
  name: string
  image: string
  passwordEnv: string
  connectionEnv: string
  connectionUrl: string
  healthCommand: string
  interval: number
  timeout: number
  retries: number
  startPeriod: number
  envText: string
}

const auth = useAuthStore()
const project = ref<Project | null>(null)
const current = ref<RepoProfileCurrent | null>(null)
const validations = ref<RepoProfileValidation[]>([])
const hasMoreValidations = ref(false)
const loadingMoreValidations = ref(false)
const loading = ref(false)
const busy = ref('')
const error = ref('')
const success = ref('')
const warnings = ref<string[]>([])
const egressText = ref('')
const repoUrl = ref('')
const baseBranch = ref('')
const image = ref('')
const languagesText = ref('')
const cachesText = ref('')
const setupText = ref('')
const verifyText = ref('')
const flakyTestsText = ref('')
const flakyRetries = ref(2)
const testDataSetupText = ref('')
const testDataCleanupText = ref('')
const envRows = ref<EnvRow[]>([])
const services = ref<ServiceRow[]>([])
const viewingVersion = ref<RepoProfileRow | null>(null)
const setupMinutes = ref(15)
const verifyMinutes = ref(20)
const maxRoundMinutes = ref(45)
let pollTimer: ReturnType<typeof setTimeout> | null = null

const active = computed(() => current.value?.active || null)
const latest = computed(() => current.value?.latest || null)
const draft = computed<RepoProfileRow | null>(() => (
  latest.value?.status === 'draft' ? latest.value : null
))
const canEdit = computed(() => {
  if (auth.isSuperAdmin()) return true
  const ownerId = project.value?.ownerId
  const userId = auth.user?.value?.id
  return Boolean(ownerId && userId && String(ownerId) === String(userId))
})
// Only the current draft is editable. Viewing any other version (including
// an older draft) is read-only so Save cannot overwrite the newer draft.
const viewingHistorical = computed(() => (
  Boolean(viewingVersion.value)
    && viewingVersion.value?.id !== draft.value?.id
))
const editable = computed(() => canEdit.value && !viewingHistorical.value)
const selectedProfile = computed(() => draft.value || active.value)
const matchingValidation = computed<RepoProfileValidation | null>(() => {
  if (!draft.value?.profile_hash) return null
  return validations.value.find((validation) => (
    validation.status === 'succeeded'
      && validation.profile_id === draft.value?.id
      && validation.profile_hash === draft.value.profile_hash
  )) || null
})

function splitLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function splitCommas(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean)
}

function parseEnvText(value: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of splitLines(value)) {
    const equals = line.indexOf('=')
    if (equals <= 0) continue
    env[line.slice(0, equals).trim()] = line.slice(equals + 1)
  }
  return env
}

function formatEnv(env: Record<string, string> | undefined): string {
  return Object.entries(env || {}).map(([key, value]) => `${key}=${value}`).join('\n')
}

function toEnvRows(env: Record<string, string> | undefined): EnvRow[] {
  return Object.entries(env || {}).map(([key, value]) => ({ key, value }))
}

function toServiceRow(service: RepoService): ServiceRow {
  return {
    name: service.name,
    image: service.image,
    passwordEnv: service.password_env || '',
    connectionEnv: service.connection_env,
    connectionUrl: service.connection_url,
    healthCommand: service.healthcheck.command,
    interval: service.healthcheck.interval_seconds,
    timeout: service.healthcheck.timeout_seconds,
    retries: service.healthcheck.retries,
    startPeriod: service.healthcheck.start_period_seconds || 0,
    envText: formatEnv(service.env),
  }
}

function emptyService(): ServiceRow {
  return {
    name: '',
    image: '',
    passwordEnv: '',
    connectionEnv: '',
    connectionUrl: '',
    healthCommand: '',
    interval: 2,
    timeout: 5,
    retries: 30,
    startPeriod: 0,
    envText: '',
  }
}

function populate(row: RepoProfileRow | null) {
  const profile = row?.profile
  repoUrl.value = profile?.repo_url || ''
  baseBranch.value = profile?.base_branch || ''
  image.value = profile?.image || ''
  languagesText.value = (profile?.languages || []).join(', ')
  cachesText.value = (profile?.caches || []).join(', ')
  setupText.value = (profile?.setup || []).join('\n')
  verifyText.value = (profile?.verify || []).join('\n')
  flakyTestsText.value = (profile?.flaky_tests || []).join('\n')
  flakyRetries.value = profile?.flaky_retries ?? 2
  testDataSetupText.value = (profile?.test_data?.setup || []).join('\n')
  testDataCleanupText.value = (profile?.test_data?.cleanup || []).join('\n')
  envRows.value = toEnvRows(profile?.env)
  services.value = (profile?.services || []).map(toServiceRow)
  setupMinutes.value = profile?.timeouts?.setup_minutes || 15
  verifyMinutes.value = profile?.timeouts?.verify_minutes || 20
  maxRoundMinutes.value = profile?.max_round_minutes || 45
  egressText.value = profile?.egress ? JSON.stringify(profile.egress, null, 2) : ''
}

function buildProfile(): RepoProfile {
  const env: Record<string, string> = {}
  for (const row of envRows.value) {
    if (row.key.trim()) env[row.key.trim()] = row.value
  }
  const profile: RepoProfile = {
    schema_version: 1,
    repo_url: repoUrl.value || undefined,
    base_branch: baseBranch.value || undefined,
    languages: splitCommas(languagesText.value),
    image: image.value || undefined,
    setup: splitLines(setupText.value),
    verify: splitLines(verifyText.value),
    caches: splitCommas(cachesText.value),
    env,
    timeouts: {
      setup_minutes: Number(setupMinutes.value) || 15,
      verify_minutes: Number(verifyMinutes.value) || 20,
    },
    max_round_minutes: Number(maxRoundMinutes.value) || 45,
    services: services.value.map((service) => ({
      name: service.name,
      image: service.image,
      env: parseEnvText(service.envText),
      password_env: service.passwordEnv || undefined,
      connection_env: service.connectionEnv,
      connection_url: service.connectionUrl,
      healthcheck: {
        command: service.healthCommand,
        interval_seconds: Number(service.interval) || 2,
        timeout_seconds: Number(service.timeout) || 5,
        retries: Number(service.retries) || 30,
        start_period_seconds: Number(service.startPeriod) || 0,
      },
    })),
    flaky_tests: splitLines(flakyTestsText.value),
    flaky_retries: Math.max(0, Math.min(2, Math.trunc(Number(flakyRetries.value) || 0))),
    test_data: {
      setup: splitLines(testDataSetupText.value),
      cleanup: splitLines(testDataCleanupText.value),
    },
  }
  if (egressText.value.trim()) {
    profile.egress = JSON.parse(egressText.value)
  }
  return profile
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    project.value = await fetchProjectById(props.projectId)
    current.value = await getRepoProfile(props.projectId)
    const firstPage = await listProfileValidations(
      props.projectId,
      { limit: VALIDATION_PAGE_SIZE },
    ).catch(() => [])
    validations.value = firstPage
    hasMoreValidations.value = firstPage.length === VALIDATION_PAGE_SIZE
    viewingVersion.value = null
    populate(selectedProfile.value)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load the repo profile'
  } finally {
    loading.value = false
  }
}

async function loadMoreValidations() {
  if (loadingMoreValidations.value || !hasMoreValidations.value) return
  loadingMoreValidations.value = true
  error.value = ''
  try {
    const page = await listProfileValidations(props.projectId, {
      limit: VALIDATION_PAGE_SIZE,
      offset: validations.value.length,
    })
    validations.value = [...validations.value, ...page]
    hasMoreValidations.value = page.length === VALIDATION_PAGE_SIZE
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not load older dry runs'
  } finally {
    loadingMoreValidations.value = false
  }
}

async function detect() {
  const hasContent = Boolean(latest.value)
    || baseBranch.value.trim() !== ''
    || image.value.trim() !== ''
    || languagesText.value.trim() !== ''
    || setupText.value.trim() !== ''
    || verifyText.value.trim() !== ''
    || egressText.value.trim() !== ''
    || services.value.length > 0
    || envRows.value.length > 0
    || Number(setupMinutes.value) !== 15
    || Number(verifyMinutes.value) !== 20
    || Number(maxRoundMinutes.value) !== 45
  if (hasContent && typeof window !== 'undefined'
      && !window.confirm('Detection will replace the current form contents. Continue?')) {
    return
  }
  busy.value = 'detect'
  error.value = ''
  warnings.value = []
  try {
    const result = await detectRepoProfile(props.projectId)
    viewingVersion.value = null
    populate({
      id: '',
      project_id: props.projectId,
      version: 0,
      profile: result.profile,
      profile_hash: null,
      status: 'draft',
    })
    warnings.value = result.warnings || []
    success.value = result.detected ? 'Detected a profile; review it before saving.' : 'No test commands detected; edit the profile manually.'
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Detection failed'
  } finally {
    busy.value = ''
  }
}

async function save() {
  busy.value = 'save'
  error.value = ''
  success.value = ''
  try {
    const profile = buildProfile()
    if (draft.value) {
      await updateRepoProfile(props.projectId, draft.value.id, profile)
      success.value = 'Draft saved'
    } else {
      await createRepoProfile(props.projectId, profile)
      success.value = 'Draft created'
    }
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not save the profile'
  } finally {
    busy.value = ''
  }
}

async function createVersion() {
  busy.value = 'version'
  error.value = ''
  success.value = ''
  try {
    const source = active.value?.profile || latest.value?.profile
    if (!source) return
    await createRepoProfile(props.projectId, source)
    success.value = 'New draft version created'
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not create a new version'
  } finally {
    busy.value = ''
  }
}

function selectVersion(row: RepoProfileRow) {
  viewingVersion.value = row
  populate(row)
  success.value = `Showing version ${row.version} (${row.status})`
}

function returnToEditor() {
  viewingVersion.value = null
  populate(selectedProfile.value)
  success.value = ''
}

function schedulePoll(validationId: string) {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = setTimeout(async () => {
    try {
      const update = await getProfileValidation(props.projectId, validationId)
      validations.value = [
        update,
        ...validations.value.filter((item) => item.id !== update.id),
      ]
      if (update.status === 'queued' || update.status === 'running') {
        schedulePoll(validationId)
      } else {
        busy.value = ''
        success.value = update.status === 'succeeded'
          ? 'Dry run succeeded'
          : 'Dry run failed; review the output below.'
        await load()
      }
    } catch (err) {
      busy.value = ''
      error.value = err instanceof Error ? err.message : 'Could not read validation status'
    }
  }, 1500)
}

async function validate() {
  const target = draft.value
  if (!target) return
  busy.value = 'validate'
  error.value = ''
  success.value = ''
  try {
    const validation = await requestProfileValidation(props.projectId, target.id)
    validations.value = [validation, ...validations.value]
    schedulePoll(validation.id)
  } catch (err) {
    busy.value = ''
    error.value = err instanceof Error ? err.message : 'Could not queue validation'
  }
}

async function activate() {
  if (!draft.value) return
  busy.value = 'activate'
  error.value = ''
  success.value = ''
  try {
    await activateRepoProfile(props.projectId, draft.value.id)
    success.value = 'Profile activated'
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Could not activate the profile'
  } finally {
    busy.value = ''
  }
}

function addEnvRow() {
  envRows.value.push({ key: '', value: '' })
}

function removeEnvRow(index: number) {
  envRows.value.splice(index, 1)
}

function addService() {
  services.value.push(emptyService())
}

function removeService(index: number) {
  services.value.splice(index, 1)
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : '—'
}

function validationCommands(validation: RepoProfileValidation): Array<Record<string, unknown>> {
  const commands = validation.result?.commands
  return Array.isArray(commands) ? commands as Array<Record<string, unknown>> : []
}

onMounted(load)
onBeforeUnmount(() => {
  if (pollTimer) clearTimeout(pollTimer)
})
</script>

<template>
  <section class="repo-profile-editor">
    <div v-if="loading" class="muted">Loading repository profile…</div>
    <template v-else>
      <div class="profile-header">
        <div>
          <h2>Repository Profile</h2>
          <p class="muted">
            Versioned setup, verification, environment and service configuration for this repository.
          </p>
        </div>
        <div class="actions">
          <button v-if="canEdit" class="btn secondary" :disabled="busy !== ''" @click="detect">
            {{ busy === 'detect' ? 'Detecting…' : 'Detect from repo' }}
          </button>
          <button v-if="canEdit && !draft && latest" class="btn secondary" :disabled="busy !== ''" @click="createVersion">
            {{ busy === 'version' ? 'Creating…' : 'New version' }}
          </button>
        </div>
      </div>

      <div v-if="!canEdit" class="banner readonly">
        Read-only — only the project owner or a super admin can change the repository profile.
      </div>
      <div v-if="viewingHistorical" class="banner readonly">
        Viewing version {{ viewingVersion?.version }} ({{ viewingVersion?.status }}) — read-only.
        <button type="button" class="btn small" @click="returnToEditor">Back to editor</button>
      </div>
      <div v-if="error" class="banner error">{{ error }}</div>
      <div v-if="success" class="banner success">{{ success }}</div>
      <div v-for="warning in warnings" :key="warning" class="banner warning">{{ warning }}</div>

      <div v-if="latest" class="status-line">
        <span class="pill" :class="latest.status">{{ latest.status }}</span>
        <span>Version {{ latest.version }}</span>
        <span v-if="latest.activated_at">Activated {{ formatDate(latest.activated_at) }}</span>
        <span v-if="draft && !matchingValidation" class="muted">Validation required for this exact draft before activation.</span>
      </div>
      <div v-else class="banner warning">
        No profile exists yet. Detect a stack or enter commands, then save a draft.
      </div>

      <fieldset class="form" :disabled="!editable">
        <div class="grid two">
          <label>Base branch
            <input v-model="baseBranch" type="text" placeholder="main" />
          </label>
          <label>Image (digest pinned)
            <input v-model="image" type="text" placeholder="registry/example@sha256:…" />
          </label>
        </div>
        <label>Languages
          <input v-model="languagesText" type="text" placeholder="node, java" />
        </label>
        <label>Caches (comma separated)
          <input v-model="cachesText" type="text" placeholder="npm, maven" />
        </label>
        <div class="grid two">
          <label>Setup commands (one per line)
            <textarea v-model="setupText" rows="4" placeholder="npm ci" />
          </label>
          <label>Verify commands (one per line)
            <textarea v-model="verifyText" rows="4" placeholder="npm test" />
          </label>
        </div>
        <div class="grid two">
          <label>Known-flaky tests (one per line)
            <textarea v-model="flakyTestsText" rows="3" placeholder="test/known-flake.test.js" />
          </label>
          <label>Flaky retries (0-2)
            <input v-model.number="flakyRetries" type="number" min="0" max="2" />
          </label>
        </div>
        <div class="grid two">
          <label>Test-data setup (one per line)
            <textarea v-model="testDataSetupText" rows="3" placeholder="npm run seed" />
          </label>
          <label>Test-data cleanup (one per line)
            <textarea v-model="testDataCleanupText" rows="3" placeholder="npm run seed:reset" />
          </label>
        </div>
        <div class="grid three">
          <label>Setup minutes
            <input v-model.number="setupMinutes" type="number" min="1" max="120" />
          </label>
          <label>Verify minutes
            <input v-model.number="verifyMinutes" type="number" min="1" max="180" />
          </label>
          <label>Max round minutes
            <input v-model.number="maxRoundMinutes" type="number" min="1" max="240" />
          </label>
        </div>

        <div class="section-heading">
          <h3>Environment</h3>
          <button v-if="editable" type="button" class="btn small" @click="addEnvRow">Add variable</button>
        </div>
        <div v-for="(row, index) in envRows" :key="`env-${index}`" class="row">
          <input v-model="row.key" type="text" placeholder="KEY" />
          <input v-model="row.value" type="text" placeholder="value" />
          <button v-if="editable" type="button" class="btn small danger" @click="removeEnvRow(index)">Remove</button>
        </div>

        <div class="section-heading">
          <h3>Services</h3>
          <button v-if="editable" type="button" class="btn small" @click="addService">Add service</button>
        </div>
        <p class="muted">
          Services run as ephemeral containers on an internal per-run network. Passwords are generated per run;
          use <code>${password}</code> and <code>${host}</code> in the connection URL.
        </p>
        <div v-for="(service, index) in services" :key="`service-${index}`" class="service-card">
          <div class="service-header">
            <strong>Service {{ index + 1 }}</strong>
            <button v-if="editable" type="button" class="btn small danger" @click="removeService(index)">Remove</button>
          </div>
          <div class="grid two">
            <label>Name
              <input v-model="service.name" type="text" placeholder="postgres" />
            </label>
            <label>Image (digest pinned)
              <input v-model="service.image" type="text" placeholder="postgres@sha256:…" />
            </label>
          </div>
          <div class="grid two">
            <label>Password env
              <input v-model="service.passwordEnv" type="text" placeholder="POSTGRES_PASSWORD" />
            </label>
            <label>Connection env
              <input v-model="service.connectionEnv" type="text" placeholder="DATABASE_URL" />
            </label>
          </div>
          <label>Connection URL template
            <input v-model="service.connectionUrl" type="text" placeholder="postgresql://user:${password}@${host}:5432/db" />
          </label>
          <label>Service environment (KEY=VALUE per line)
            <textarea v-model="service.envText" rows="2" placeholder="POSTGRES_USER=vibecode" />
          </label>
          <label>Health command
            <input v-model="service.healthCommand" type="text" placeholder="pg_isready -U vibecode" />
          </label>
          <div class="grid three">
            <label>Interval (s)
              <input v-model.number="service.interval" type="number" min="1" max="60" />
            </label>
            <label>Timeout (s)
              <input v-model.number="service.timeout" type="number" min="1" max="60" />
            </label>
            <label>Retries
              <input v-model.number="service.retries" type="number" min="1" max="120" />
            </label>
            <label>Start period (s)
              <input v-model.number="service.startPeriod" type="number" min="0" max="120" />
            </label>
          </div>
        </div>

        <details class="advanced">
          <summary>Advanced egress</summary>
          <p class="muted">
            Optional <code>egress</code> JSON. Origin CA hosts must already be allowlisted on the agent.
          </p>
          <textarea v-model="egressText" rows="6" placeholder='{"tls_mode":"terminate","origin_ca_hosts":["registry.example.com"],"origin_ca_b64":"…"}' />
        </details>
      </fieldset>

      <div v-if="canEdit" class="actions sticky">
        <button class="btn primary" :disabled="busy !== '' || !editable" @click="save">
          {{ busy === 'save' ? 'Saving…' : draft ? 'Save draft' : 'Create draft' }}
        </button>
        <button
          class="btn secondary"
          :disabled="busy !== '' || !draft || viewingHistorical"
          :title="draft ? 'Validate the current draft' : 'Save or create a draft first'"
          @click="validate"
        >
          {{ busy === 'validate' ? 'Queuing…' : 'Validate (dry run)' }}
        </button>
        <button
          class="btn success"
          :disabled="busy !== '' || !draft || !matchingValidation || viewingHistorical"
          :title="matchingValidation ? 'Activate this validated draft' : 'Run a successful dry run for this exact draft first'"
          @click="activate"
        >
          {{ busy === 'activate' ? 'Activating…' : 'Activate' }}
        </button>
      </div>

      <div class="grid two history">
        <div>
          <h3>Versions</h3>
          <table class="table">
            <thead><tr><th>Version</th><th>Status</th><th>Created</th><th></th></tr></thead>
            <tbody>
              <tr v-for="row in current?.versions || []" :key="row.id">
                <td>{{ row.version }}</td>
                <td><span class="pill" :class="row.status">{{ row.status }}</span></td>
                <td>{{ formatDate(row.created_at) }}</td>
                <td><button class="btn small" type="button" @click="selectVersion(row)">View</button></td>
              </tr>
              <tr v-if="!(current?.versions || []).length"><td colspan="4" class="muted">No versions yet.</td></tr>
            </tbody>
          </table>
        </div>
        <div>
          <h3>Dry runs</h3>
          <p class="muted">
            Showing {{ validations.length }} dry run{{ validations.length === 1 ? '' : 's' }}.
          </p>
          <div v-if="!validations.length" class="muted">No dry runs yet.</div>
          <div v-for="validation in validations" :key="validation.id" class="validation">
            <div class="validation-header">
              <span class="pill" :class="validation.status">{{ validation.status }}</span>
              <span>v{{ validation.profile_version }}</span>
              <span class="muted">{{ formatDate(validation.created_at) }}</span>
            </div>
            <p v-if="validation.error" class="error-text">{{ validation.error }}</p>
            <pre v-for="(command, index) in validationCommands(validation)" :key="index" class="command">{{ command.phase }}: {{ command.command || command.reason }}
exit {{ command.exitCode ?? '—' }}<template v-if="command.output"> — {{ command.output }}</template></pre>
            <p v-if="validation.result === null" class="muted">
              Command output is visible to the project owner or a super admin.
            </p>
          </div>
          <button
            v-if="hasMoreValidations"
            class="btn small"
            type="button"
            :disabled="loadingMoreValidations"
            @click="loadMoreValidations"
          >
            {{ loadingMoreValidations ? 'Loading…' : 'Load older dry runs' }}
          </button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.repo-profile-editor { display: flex; flex-direction: column; gap: 16px; }
.profile-header { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
.profile-header h2 { margin: 0 0 4px; }
.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.actions.sticky { position: sticky; bottom: 0; background: #fff; padding: 12px 0; border-top: 1px solid #e5e7eb; }
.banner { padding: 10px 12px; border-radius: 8px; border: 1px solid transparent; }
.banner.error, .error-text { color: #b91c1c; background: #fef2f2; border-color: #fecaca; }
.banner.success { color: #166534; background: #f0fdf4; border-color: #bbf7d0; }
.banner.warning { color: #92400e; background: #fffbeb; border-color: #fde68a; }
.banner.readonly { color: #374151; background: #f9fafb; border-color: #e5e7eb; }
.status-line { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
.form { border: 1px solid #e5e7eb; border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.grid { display: grid; gap: 12px; }
.grid.two { grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
.grid.three { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); }
label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; color: #374151; }
input, textarea { width: 100%; border: 1px solid #d1d5db; border-radius: 7px; padding: 8px; font: inherit; }
textarea { resize: vertical; }
.section-heading { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.section-heading h3, .history h3 { margin: 0; font-size: 15px; }
.row { display: grid; grid-template-columns: 1fr 2fr auto; gap: 8px; margin-bottom: 6px; }
.service-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 10px; background: #fafafa; }
.service-header { display: flex; justify-content: space-between; align-items: center; }
.advanced { border-top: 1px solid #e5e7eb; padding-top: 10px; }
.advanced summary { cursor: pointer; font-weight: 600; }
.history { margin-top: 8px; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { text-align: left; padding: 6px; border-bottom: 1px solid #e5e7eb; }
.pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #f3f4f6; color: #374151; }
.pill.active, .pill.succeeded { background: #dcfce7; color: #166534; }
.pill.draft, .pill.queued, .pill.running { background: #e0f2fe; color: #075985; }
.pill.failed, .pill.inactive { background: #fee2e2; color: #991b1b; }
.validation { border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px; margin-bottom: 8px; }
.validation-header { display: flex; gap: 8px; align-items: center; }
.command { white-space: pre-wrap; background: #111827; color: #f9fafb; padding: 6px; border-radius: 6px; font-size: 11px; max-height: 120px; overflow: auto; }
.btn { border: 1px solid #d1d5db; background: #fff; border-radius: 7px; padding: 7px 11px; cursor: pointer; font: inherit; }
.btn:disabled { opacity: .55; cursor: not-allowed; }
.btn.primary { background: #2563eb; border-color: #2563eb; color: #fff; }
.btn.success { background: #16a34a; border-color: #16a34a; color: #fff; }
.btn.secondary { background: #f9fafb; }
.btn.danger { color: #b91c1c; }
.btn.small { padding: 4px 8px; font-size: 12px; }
.muted { color: #6b7280; font-size: 13px; }
code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
</style>
