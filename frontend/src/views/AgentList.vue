<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { fetchAgentStatusList, createAgent, listAgents, updateAgentName } from '@/api/agents'
import { listProviders } from '@/api/providers'
import { fetchProjects } from '@/api/projects'
import {
  listEnrollmentTokens,
  mintEnrollmentToken,
  revokeEnrollmentToken,
} from '@/api/agentEnrollment'
import { useAuthStore } from '@/stores/auth'
import AgentModal from '@/components/AgentModal.vue'
import AgentKeyRevealModal from '@/components/AgentKeyRevealModal.vue'

const agents = ref([])
const loading = ref(true)
const error = ref(null)
const showCreateModal = ref(false)
const createError = ref(null)
const creatingAgent = ref(false)
const createdAgent = ref(null)
const activeTab = ref('heartbeat')
const agentsData = ref([])
const loadingAgents = ref(false)
const providers = ref([])
const selectedProviderId = ref(null)
const router = useRouter()
const CREATE_TIMEOUT_MS = 30000
let createAttempt = 0
let pollInterval = null
const editingAgentId = ref(null)
const editName = ref('')

const authStore = useAuthStore()
const projects = ref([])
const enrollmentProjectId = ref('')
const enrollmentTokens = ref([])
const enrollmentLoading = ref(false)
const enrollmentError = ref('')
const enrollmentAvailable = ref(true)
const minting = ref(false)
const mintedToken = ref(null)
const revokingTokenId = ref(null)
const mintForm = ref({ name: '', ttlMinutes: 15, maxUses: 1, providerId: '' })

const canReadEnrollment = computed(() => authStore.hasAnyPermission(['AGENT_READ']))
const canMintEnrollment = computed(() => authStore.canCreateAgent())
const canRevokeEnrollment = computed(() => authStore.canRevokeAgent())

async function loadAgents() {
  try {
    const data = await fetchAgentStatusList()
    agents.value = data || []
  } catch (err) {
    console.error('Failed to load agents:', err)
    error.value = 'Failed to load agents'
  } finally {
    loading.value = false
  }
}

async function loadProviders() {
  try {
    providers.value = await listProviders()
  } catch (err) {
    console.error('Failed to load providers:', err)
  }
}

onMounted(() => {
  loadAgents()
  loadProviders()
  pollInterval = setInterval(loadAgents, 10000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})

watch(activeTab, (tab) => {
  if (tab === 'agents') {
    loadCrudAgents()
  }
  if (tab === 'enrollment' && canReadEnrollment.value) {
    loadEnrollmentPanel()
  }
})

watch(enrollmentProjectId, () => {
  if (activeTab.value === 'enrollment' && enrollmentProjectId.value) {
    loadEnrollmentTokens()
  }
})

function viewDetail(agentId) {
  router.push(`/agents/${agentId}`)
}

function openCreateModal() {
  createError.value = null
  showCreateModal.value = true
}

function statusClass(status) {
  return { online: 'status-online', idle: 'status-idle', offline: 'status-offline' }[status] || 'status-offline'
}

function formatCost(cost) {
  return `$${Number(cost || 0).toFixed(2)}`
}

async function handleCreate(name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays) {
  const attempt = ++createAttempt
  creatingAgent.value = true
  createError.value = null
  let timedOut = false
  const timer = setTimeout(() => {
    if (attempt !== createAttempt) return
    timedOut = true
    // Re-enable dismissal so a hung request cannot trap the dialog. The
    // request itself cannot be cancelled safely; if it later succeeds the
    // operator can rotate the key from the agent page.
    creatingAgent.value = false
    createError.value = 'Creating the agent is taking longer than expected. Refresh the list before retrying; if the agent appears, rotate its key.'
  }, CREATE_TIMEOUT_MS)

  try {
    const created = await createAgent({ name, providerId, rateLimit, maxActionsPerDay, keyExpiryDays })
    if (attempt !== createAttempt || timedOut) return
    showCreateModal.value = false

    const provider = providers.value.find(p =>
      String(p.id) === String(created.provider_id ?? providerId)
    )
    createdAgent.value = {
      id: created.id,
      name: created.name || name,
      providerName: created.provider_name || provider?.name || null,
      apiKey: created.generatedApiKey || created.api_key || null,
      expiresAt: created.api_key_expires_at || null,
    }

    // Refresh both tables immediately instead of waiting for the poll or a
    // tab switch.
    await Promise.all([loadAgents(), loadCrudAgents()])
  } catch (err) {
    if (attempt !== createAttempt || timedOut) return
    createError.value = err.message || 'Failed to create agent'
  } finally {
    clearTimeout(timer)
    if (attempt === createAttempt && !timedOut) creatingAgent.value = false
  }
}

function startEdit(agent) {
  editingAgentId.value = agent.id
  editName.value = agent.name
}

async function saveEdit(agent) {
  if (!editName.value.trim()) return
  try {
    await updateAgentName(String(agent.id), editName.value.trim())
    editingAgentId.value = null
    loadCrudAgents()
  } catch (err) {
    console.error('Failed to update agent name:', err)
  }
}

function cancelEdit() {
  editingAgentId.value = null
}

const tabs = computed(() => [
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'agents', label: 'Agents' },
  ...(enrollmentAvailable.value ? [{ id: 'enrollment', label: 'Enrollment' }] : []),
])

async function loadEnrollmentPanel() {
  if (projects.value.length === 0) {
    try {
      projects.value = await fetchProjects()
    } catch (err) {
      console.error('Failed to load projects:', err)
    }
  }
  if (!enrollmentProjectId.value && projects.value.length > 0) {
    enrollmentProjectId.value = String(projects.value[0].id)
  }
  await loadEnrollmentTokens()
}

async function loadEnrollmentTokens() {
  if (!enrollmentProjectId.value) {
    enrollmentTokens.value = []
    return
  }
  enrollmentLoading.value = true
  enrollmentError.value = ''
  try {
    enrollmentTokens.value = await listEnrollmentTokens(enrollmentProjectId.value)
  } catch (err) {
    if (err.status === 404) {
      // Feature flag off: remove the surface instead of advertising it.
      enrollmentAvailable.value = false
      enrollmentError.value = ''
      if (activeTab.value === 'enrollment') activeTab.value = 'heartbeat'
    } else {
      enrollmentError.value = err.message || 'Failed to load join tokens'
    }
  } finally {
    enrollmentLoading.value = false
  }
}

async function submitMint() {
  if (!mintForm.value.name.trim() || !enrollmentProjectId.value) return
  minting.value = true
  enrollmentError.value = ''
  try {
    const created = await mintEnrollmentToken({
      projectId: enrollmentProjectId.value,
      name: mintForm.value.name.trim(),
      ttlSeconds: Math.max(1, Number(mintForm.value.ttlMinutes) || 15) * 60,
      maxUses: Number(mintForm.value.maxUses) || 1,
      providerId: mintForm.value.providerId || null,
    })
    // The raw token exists only in this response; keep it in memory for the
    // one-time dialog and never persist it.
    mintedToken.value = created
    mintForm.value.name = ''
    await loadEnrollmentTokens()
  } catch (err) {
    enrollmentError.value = err.message || 'Failed to mint join token'
  } finally {
    minting.value = false
  }
}

async function revokeToken(token) {
  revokingTokenId.value = token.id
  enrollmentError.value = ''
  try {
    await revokeEnrollmentToken(token.id)
    await loadEnrollmentTokens()
  } catch (err) {
    enrollmentError.value = err.message || 'Failed to revoke join token'
  } finally {
    revokingTokenId.value = null
  }
}

function enrollmentProviderName(providerId) {
  if (!providerId) return 'Any'
  const provider = providers.value.find(p => String(p.id) === String(providerId))
  return provider ? provider.name : `Provider ${providerId}`
}

function enrollmentStatus(token) {
  if (token.revoked_at) return 'revoked'
  if (new Date(token.expires_at) <= new Date()) return 'expired'
  if (token.used_count >= token.max_uses) return 'used'
  return 'active'
}

async function loadCrudAgents() {
  loadingAgents.value = true
  try {
    const { agents } = await listAgents()
    agentsData.value = agents || []
  } catch {
    agentsData.value = []
  } finally {
    loadingAgents.value = false
  }
}



function formatDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleDateString() : '—'
}
</script>

<template>
  <div class="agent-list">
    <div class="header-row">
      <h1>Agents</h1>
      <button class="btn-primary" @click="openCreateModal">
        Create Agent
      </button>
    </div>
    <AgentModal
      v-model:show="showCreateModal"
      :providers="providers"
      :creating="creatingAgent"
      :submit-error="createError"
      v-model:selectedProvider="selectedProviderId"
      @created="handleCreate"
    />
    <AgentKeyRevealModal
      v-if="createdAgent"
      :agent="createdAgent"
      @close="createdAgent = null"
    />
    <AgentKeyRevealModal
      v-if="mintedToken"
      :agent="{ id: mintedToken.id, name: mintedToken.name, apiKey: mintedToken.token }"
      title="Join token created"
      intro="Give this token to the new node. It is exchanged once for its own short-lived credentials."
      warning="This is the only time this join token is shown. It expires automatically and can be revoked."
      copy-label="Copy token"
      @close="mintedToken = null"
    />

    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        :class="['tab', { active: activeTab === tab.id }]"
        @click="activeTab = tab.id"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Heartbeat Tab -->
    <div v-if="activeTab === 'heartbeat'">
      <div v-if="loading" class="loading">Loading agents...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <div v-else>
        <table v-if="agents.length > 0" class="agent-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th>Current Ticket</th>
              <th>Actions Today</th>
              <th>Cost Today</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="agent in agents"
              :key="agent.agent_id"
              @click="viewDetail(agent.agent_id)"
              class="agent-row"
            >
              <td>{{ agent.name || agent.agent_id }}</td>
              <td>
                <span :class="['status-badge', statusClass(agent.status)]">
                  {{ agent.status }}
                </span>
              </td>
              <td>
                <router-link
                  v-if="agent.current_ticket_id"
                  :to="`/projects/?ticket=${agent.current_ticket_id}`"
                  @click.stop
                >
                  {{ agent.current_ticket_title || agent.current_ticket_id.substring(0, 8) + '...' }}
                </router-link>
                <span v-else class="none">—</span>
              </td>
              <td>{{ agent.actions_today }}</td>
              <td>{{ formatCost(agent.cost_today) }}</td>
              <td>
                {{ agent.last_seen ? new Date(agent.last_seen).toLocaleString() : 'Never' }}
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">
          <p>No heartbeat data found.</p>
          <p class="empty-hint">Agents may not have sent heartbeats recently.</p>
        </div>
      </div>
    </div>

    <!-- Agents Tab (CRUD) -->
    <div v-if="activeTab === 'agents'">
      <div v-if="loadingAgents" class="loading">Loading agents...</div>
      <table v-else-if="agentsData.length > 0" class="agent-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Provider</th>
            <th>API Key</th>
            <th>Rate Limit</th>
            <th>Created</th>
            <th>Actions</th>
          </tr>
        </thead>
          <tbody>
            <tr v-for="agent in agentsData" :key="agent.id">
              <td v-if="editingAgentId === agent.id">
                <input v-model="editName" @keyup.enter="saveEdit(agent)" @keyup.escape="cancelEdit" @blur="saveEdit(agent)" class="edit-input" />
                <button @click="cancelEdit" class="btn-sm">Cancel</button>
              </td>
              <td v-else>
                <span>{{ agent.name }}</span>
                <button @click="startEdit(agent)" class="btn-edit" title="Edit name">Edit</button>
              </td>
              <td>{{ agent.provider_name || '—' }}</td>
            <td><code>••••••••</code> <router-link :to="`/agents/${agent.id}`" class="link-details">View</router-link></td>
            <td>{{ agent.rate_limit || 100 }}</td>
            <td>{{ formatDate(agent.created_at) }}</td>
            <td>
              <router-link :to="`/agents/${agent.id}`" class="link-details">
                View Details
              </router-link>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="empty-state">
        <p>No agents created yet.</p>
        <p class="empty-hint">Click "Create Agent" to get started.</p>
      </div>
    </div>

    <!-- Enrollment Tab -->
    <div v-if="activeTab === 'enrollment'">
      <div v-if="!canReadEnrollment" class="empty-state">
        <p>You do not have permission to view join tokens.</p>
      </div>
      <template v-else>
        <div class="enrollment-toolbar">
          <label for="enrollment-project">Project</label>
          <select id="enrollment-project" v-model="enrollmentProjectId">
            <option value="" disabled>Select a project</option>
            <option v-for="project in projects" :key="project.id" :value="String(project.id)">
              {{ project.name }}
            </option>
          </select>
        </div>

        <form v-if="canMintEnrollment" class="mint-form" @submit.prevent="submitMint">
          <input v-model="mintForm.name" placeholder="Token name" maxlength="100" />
          <label>
            TTL (min)
            <input v-model.number="mintForm.ttlMinutes" type="number" min="1" max="1440" />
          </label>
          <label>
            Max uses
            <input v-model.number="mintForm.maxUses" type="number" min="1" max="100" />
          </label>
          <select v-model="mintForm.providerId">
            <option value="">Any provider</option>
            <option v-for="provider in providers" :key="provider.id" :value="String(provider.id)">
              {{ provider.name }}
            </option>
          </select>
          <button
            type="submit"
            class="btn-primary"
            :disabled="minting || !mintForm.name.trim() || !enrollmentProjectId"
          >
            {{ minting ? 'Minting...' : 'Mint join token' }}
          </button>
        </form>

        <div v-if="enrollmentError" class="error">{{ enrollmentError }}</div>

        <div v-if="enrollmentLoading" class="loading">Loading join tokens...</div>
        <table v-else-if="enrollmentTokens.length > 0" class="agent-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Provider</th>
              <th>Uses</th>
              <th>Expires</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="token in enrollmentTokens" :key="token.id">
              <td>{{ token.name }}</td>
              <td>{{ enrollmentProviderName(token.provider_id) }}</td>
              <td>{{ token.used_count }} / {{ token.max_uses }}</td>
              <td>{{ formatDate(token.expires_at) }}</td>
              <td>
                <span :class="['token-status', `token-${enrollmentStatus(token)}`]">
                  {{ enrollmentStatus(token) }}
                </span>
              </td>
              <td>
                <button
                  v-if="canRevokeEnrollment && !token.revoked_at"
                  class="btn-danger-outline"
                  :disabled="revokingTokenId === token.id"
                  @click="revokeToken(token)"
                >
                  {{ revokingTokenId === token.id ? 'Revoking...' : 'Revoke' }}
                </button>
                <span v-else class="none">—</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty-state">
          <p>No join tokens for this project.</p>
          <p class="empty-hint">Mint one to enroll a new node without copying a long-lived key.</p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.agent-list {
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.agent-list h1 {
  margin: 0 0 1rem 0;
  font-size: 24px;
  color: #1f2937;
}

.loading, .error {
  padding: 40px 20px;
  text-align: center;
  color: #6b7280;
}

.enrollment-toolbar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.enrollment-toolbar select,
.mint-form input,
.mint-form select {
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
}

.mint-form {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 0.75rem;
  margin-bottom: 1rem;
  padding: 1rem;
  background: #f9fafb;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.mint-form label {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 12px;
  color: #4b5563;
}

.token-status {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
  background: #e5e7eb;
  color: #374151;
}

.token-active {
  background: #d1fae5;
  color: #065f46;
}

.token-used,
.token-expired {
  background: #fef3c7;
  color: #92400e;
}

.token-revoked {
  background: #fee2e2;
  color: #991b1b;
}

.error {
  color: #ef4444;
}

.agent-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.agent-table th,
.agent-table td {
  padding: 12px 16px;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

.agent-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.agent-row {
  cursor: pointer;
  transition: background 0.2s;
}

.agent-row:hover {
  background: #f9fafb;
}

.status-badge {
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}

.status-online {
  background: #d4edda;
  color: #155724;
}

.status-idle {
  background: #fff3cd;
  color: #856404;
}

.status-offline {
  background: #f8d7da;
  color: #721c24;
}

.none {
  color: #9ca3af;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #6b7280;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.empty-hint {
  color: #9ca3af;
  font-size: 14px;
  margin-top: 4px;
}

.btn-primary {
  padding: 8px 16px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary:hover {
  background: #2563eb;
}

.tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid #e5e7eb;
  margin-bottom: 1rem;
}

.tab {
  padding: 8px 16px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  font-weight: 500;
}

.tab:hover {
  color: #374151;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
}

.link-details {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}

.link-details:hover {
  text-decoration: underline;
}

.edit-input {
  padding: 4px 8px;
  border: 1px solid #3b82f6;
  border-radius: 4px;
  font-size: 14px;
  width: 200px;
}

.btn-edit {
  padding: 2px 8px;
  background: #f3f4f6;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  margin-left: 8px;
}

.btn-edit:hover {
  background: #e5e7eb;
}

.btn-sm {
  padding: 2px 8px;
  background: #fee2e2;
  border: 1px solid #fca5a5;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  margin-left: 4px;
}
</style>
