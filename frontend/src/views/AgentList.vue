<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  createAgentGrant,
  drainAgentNode,
  mintAgentNodeToken,
  getAgentNodeGrants,
  listAgentNodes,
  revokeAgentGrant,
  revokeAgentNode,
  updateAgentRuntime,
  type AgentGrant,
  type AgentNode,
  type AgentRuntime,
  type AgentRuntimeRole,
  type AgentRuntimeStatus,
  type ResourceId,
} from '@/api/agentNodes'
import { fetchProjectsStrict, type Project } from '@/api/projects'
import { useAuthStore } from '@/stores/auth'
import VButton from '@/components/VButton.vue'

const authStore = useAuthStore()

const nodes = ref<AgentNode[]>([])
const projects = ref<Project[]>([])
const grantsByNode = ref<Record<string, AgentGrant[]>>({})
const selectedKey = ref<string | null>(null)
const loading = ref(true)
const grantsLoading = ref(false)
const loadingProjects = ref(false)
const error = ref('')
const actionError = ref('')
const projectError = ref('')
const busy = ref('')
const showMint = ref(false)
const minting = ref(false)
const mintError = ref('')
const mintedToken = ref<{ name: string; token: string; expires_at: string } | null>(null)
const mintForm = ref({ name: '', ttlMinutes: 15, maxUses: 1 })
const grantForm = ref<{ projectId: string; role: AgentRuntimeRole }>({
  projectId: '',
  role: 'worker',
})

const ROLE_OPTIONS: AgentRuntimeRole[] = ['worker', 'reviewer', 'planner']
let pollInterval: ReturnType<typeof setInterval> | null = null

const canView = computed(() => authStore.hasAnyPermission(['AGENT_READ']))
const canCreateGrant = computed(() => authStore.hasAnyPermission(['AGENT_CREATE']))
const canRevokeNode = computed(() => authStore.hasAnyPermission(['AGENT_REVOKE']))

function canManageNode(node: AgentNode): boolean {
  if (authStore.isSuperAdmin()) return true
  const userId = authStore.user.value?.id
  return userId != null && String(node.owner_id) === String(userId)
}

const selectedNode = computed<AgentNode | null>(
  () => nodes.value.find(node => nodeKey(node) === selectedKey.value) ?? null
)

const selectedRuntimes = computed<AgentRuntime[]>(() => selectedNode.value?.runtimes ?? [])

const selectedGrants = computed<AgentGrant[]>(() => {
  if (!selectedKey.value) return []
  return (grantsByNode.value[selectedKey.value] ?? []).filter(grant => !grant.revoked_at)
})

function nodeKey(node: AgentNode): string {
  return String(node.id)
}

function runtimeKey(runtime: AgentRuntime): string {
  return String(runtime.id)
}

function formatDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleDateString() : '—'
}

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Never'
}

function modelLabel(runtime: AgentRuntime): string {
  if (runtime.model_ref) return runtime.model_ref
  if (runtime.credential_name && runtime.model) {
    return `${runtime.credential_name}/${runtime.model}`
  }
  return runtime.model || String(runtime.model_id)
}

async function loadNodes(): Promise<void> {
  if (!canView.value) {
    loading.value = false
    return
  }
  try {
    nodes.value = (await listAgentNodes()) || []
    error.value = ''
  } catch (err) {
    error.value = (err as Error).message || 'Failed to load the agent fleet'
  } finally {
    loading.value = false
  }
}

async function loadProjects(): Promise<void> {
  if (!canCreateGrant.value) return
  loadingProjects.value = true
  projectError.value = ''
  try {
    projects.value = (await fetchProjectsStrict()) || []
  } catch (err) {
    projectError.value = (err as Error).message || 'Failed to load projects'
  } finally {
    loadingProjects.value = false
  }
}

async function loadGrants(node: AgentNode): Promise<void> {
  const key = nodeKey(node)
  grantsLoading.value = true
  try {
    grantsByNode.value = {
      ...grantsByNode.value,
      [key]: (await getAgentNodeGrants(node.id)) || [],
    }
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to load grants'
  } finally {
    grantsLoading.value = false
  }
}

async function refreshSelectedGrants(): Promise<void> {
  const node = selectedNode.value
  if (node) await loadGrants(node)
}

async function toggleNode(node: AgentNode): Promise<void> {
  const key = nodeKey(node)
  if (selectedKey.value === key) {
    selectedKey.value = null
    return
  }
  selectedKey.value = key
  actionError.value = ''
  if (node.grants) {
    grantsByNode.value = { ...grantsByNode.value, [key]: node.grants }
  }
  await loadGrants(node)
}

async function onDrain(node: AgentNode): Promise<void> {
  const key = nodeKey(node)
  busy.value = `drain-${key}`
  actionError.value = ''
  try {
    await drainAgentNode(node.id)
    await loadNodes()
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to drain the node'
  } finally {
    busy.value = ''
  }
}

async function onRevokeNode(node: AgentNode): Promise<void> {
  const key = nodeKey(node)
  busy.value = `revoke-${key}`
  actionError.value = ''
  try {
    await revokeAgentNode(node.id)
    await loadNodes()
    await refreshSelectedGrants()
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to revoke the node'
  } finally {
    busy.value = ''
  }
}

async function onAddGrant(node: AgentNode): Promise<void> {
  if (!grantForm.value.projectId) {
    actionError.value = 'Select a project before adding a grant'
    return
  }
  const key = nodeKey(node)
  busy.value = `grant-${key}`
  actionError.value = ''
  try {
    await createAgentGrant(node.id, {
      projectId: grantForm.value.projectId,
      role: grantForm.value.role,
    })
    grantForm.value = { projectId: '', role: 'worker' }
    await loadGrants(node)
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to create the grant'
  } finally {
    busy.value = ''
  }
}

async function onRevokeGrant(node: AgentNode, grant: AgentGrant): Promise<void> {
  const key = nodeKey(node)
  busy.value = `grant-revoke-${key}-${String(grant.id)}`
  actionError.value = ''
  try {
    await revokeAgentGrant(node.id, grant.id)
    await loadGrants(node)
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to revoke the grant'
  } finally {
    busy.value = ''
  }
}

async function onRuntimeStatus(runtime: AgentRuntime, status: AgentRuntimeStatus): Promise<void> {
  const key = runtimeKey(runtime)
  busy.value = `runtime-${key}`
  actionError.value = ''
  try {
    await updateAgentRuntime(runtime.id, { status })
    await loadNodes()
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to update the runtime'
  } finally {
    busy.value = ''
  }
}

function isBusy(prefix: string, id: ResourceId): boolean {
  return busy.value === `${prefix}-${String(id)}`
}

async function mintToken(): Promise<void> {
  mintError.value = ''
  mintedToken.value = null
  if (!mintForm.value.name.trim()) {
    mintError.value = 'A node name is required'
    return
  }
  minting.value = true
  try {
    const created = await mintAgentNodeToken({
      name: mintForm.value.name.trim(),
      ttl_seconds: Math.max(60, mintForm.value.ttlMinutes * 60),
      max_uses: Math.max(1, mintForm.value.maxUses),
    })
    mintedToken.value = {
      name: created.name,
      token: created.token,
      expires_at: created.expires_at,
    }
    mintForm.value.name = ''
  } catch (err) {
    mintError.value = (err as Error).message || 'Could not mint a join token'
  } finally {
    minting.value = false
  }
}

onMounted(async () => {
  if (!canView.value) {
    loading.value = false
    return
  }
  await Promise.all([loadNodes(), loadProjects()])
  pollInterval = setInterval(loadNodes, 15000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})
</script>

<template>
  <div class="agent-list">
    <div class="header-row">
      <div>
        <h1>Agent Fleet</h1>
        <p class="page-subtitle">
          Nodes, project grants and the runtime slots declared on each host.
        </p>
      </div>
      <div class="header-actions">
        <VButton
          v-if="canCreateGrant"
          variant="primary"
          size="small"
          @click="showMint = !showMint"
        >
          Mint join token
        </VButton>
        <VButton
          v-if="canView"
          variant="secondary"
          size="small"
          :loading="loading"
          @click="loadNodes"
        >
          Refresh
        </VButton>
      </div>
    </div>

    <div v-if="showMint && canCreateGrant" class="mint-panel">
      <h3>Mint a node join token</h3>
      <p class="hint">
        The token is shown once and enrolls one host. It carries no project or
        role; grants are added after enrollment.
      </p>
      <div class="form-row">
        <label for="mint-node-name">Node name</label>
        <input id="mint-node-name" v-model="mintForm.name" maxlength="100" placeholder="build-host-1" />
        <label for="mint-node-ttl">TTL (minutes)</label>
        <input id="mint-node-ttl" v-model.number="mintForm.ttlMinutes" type="number" min="1" max="1440" />
        <label for="mint-node-uses">Max uses</label>
        <input id="mint-node-uses" v-model.number="mintForm.maxUses" type="number" min="1" max="100" />
        <VButton variant="primary" size="small" :loading="minting" @click="mintToken">
          Mint
        </VButton>
      </div>
      <div v-if="mintError" class="error">{{ mintError }}</div>
      <div v-if="mintedToken" class="minted-token" role="status">
        <p>Token for <strong>{{ mintedToken.name }}</strong> (expires {{ formatDateTime(mintedToken.expires_at) }}):</p>
        <code>{{ mintedToken.token }}</code>
        <p class="hint">Copy it now; it is not shown again.</p>
      </div>
    </div>

    <div v-if="!canView" class="empty-state" role="status">
      <p>You do not have permission to view the agent fleet.</p>
      <p class="empty-hint">Ask a project administrator for AGENT_READ access.</p>
    </div>

    <template v-else>
      <div v-if="loading" class="loading">Loading fleet...</div>
      <div v-else-if="error" class="error">{{ error }}</div>
      <div v-else-if="nodes.length === 0" class="empty-state">
        <p>No agent nodes enrolled.</p>
        <p class="empty-hint">
          Enroll a host with a node join token before declaring runtimes on it.
        </p>
      </div>

      <div v-else class="node-list">
        <div v-if="actionError" class="error action-error">{{ actionError }}</div>

        <section v-for="node in nodes" :key="nodeKey(node)" class="node-card">
          <div class="node-header">
            <button
              type="button"
              class="node-summary"
              :aria-expanded="selectedKey === nodeKey(node)"
              @click="toggleNode(node)"
            >
              <span class="node-title">
                <span class="node-name">{{ node.name }}</span>
                <span :class="['status-badge', `status-${node.status}`]">{{ node.status }}</span>
              </span>
              <span class="node-meta">
                <span>Owner: <strong>{{ node.owner_name || node.owner_id }}</strong></span>
                <span>Host: {{ node.hostname || '—' }}</span>
                <span>Last seen: {{ formatDateTime(node.last_seen_at) }}</span>
              </span>
            </button>

            <div class="node-actions">
              <VButton
                v-if="canRevokeNode && canManageNode(node) && node.status === 'active'"
                variant="secondary"
                size="small"
                :loading="isBusy('drain', node.id)"
                @click="onDrain(node)"
              >
                Drain
              </VButton>
              <VButton
                v-if="canRevokeNode && canManageNode(node) && node.status !== 'revoked'"
                variant="danger"
                size="small"
                :loading="isBusy('revoke', node.id)"
                @click="onRevokeNode(node)"
              >
                Revoke
              </VButton>
              <router-link :to="`/agents/${node.id}`" class="link-details">
                Details
              </router-link>
            </div>
          </div>

          <div v-if="selectedKey === nodeKey(node)" class="node-detail">
            <section class="detail-section">
              <div class="section-header">
                <h2>Grants</h2>
                <span class="count">{{ selectedGrants.length }}</span>
              </div>

              <div v-if="grantsLoading" class="loading-inline">Loading grants...</div>
              <table v-else-if="selectedGrants.length > 0" class="agent-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Role</th>
                    <th>Created</th>
                    <th v-if="canCreateGrant && canManageNode(node)">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="grant in selectedGrants" :key="grant.id">
                    <td>{{ grant.project_name || grant.project_id }}</td>
                    <td><span class="role-tag">{{ grant.role }}</span></td>
                    <td>{{ formatDate(grant.created_at) }}</td>
                    <td v-if="canCreateGrant && canManageNode(node)">
                      <VButton
                        variant="danger"
                        size="small"
                        :loading="busy === `grant-revoke-${nodeKey(node)}-${String(grant.id)}`"
                        @click="onRevokeGrant(node, grant)"
                      >
                        Revoke grant
                      </VButton>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="empty-inline">No active grants.</p>

              <div v-if="canCreateGrant && canManageNode(node)" class="grant-form">
                <div class="form-group">
                  <label :for="`grant-project-${nodeKey(node)}`">Project</label>
                  <select
                    :id="`grant-project-${nodeKey(node)}`"
                    v-model="grantForm.projectId"
                    :disabled="loadingProjects"
                  >
                    <option value="" disabled>Select a project</option>
                    <option v-for="project in projects" :key="project.id" :value="String(project.id)">
                      {{ project.name }}
                    </option>
                  </select>
                </div>
                <div class="form-group">
                  <label :for="`grant-role-${nodeKey(node)}`">Role</label>
                  <select :id="`grant-role-${nodeKey(node)}`" v-model="grantForm.role">
                    <option v-for="role in ROLE_OPTIONS" :key="role" :value="role">
                      {{ role }}
                    </option>
                  </select>
                </div>
                <VButton
                  variant="primary"
                  size="small"
                  :loading="busy === `grant-${nodeKey(node)}`"
                  @click="onAddGrant(node)"
                >
                  Add grant
                </VButton>
              </div>
              <p v-if="projectError" class="error inline-error">{{ projectError }}</p>
            </section>

            <section class="detail-section">
              <div class="section-header">
                <h2>Runtimes</h2>
                <span class="count">{{ selectedRuntimes.length }}</span>
              </div>

              <table v-if="selectedRuntimes.length > 0" class="agent-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Role</th>
                    <th>Model</th>
                    <th>Effort</th>
                    <th>Status</th>
                    <th>Last seen</th>
                    <th v-if="canCreateGrant && canManageNode(node)">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="runtime in selectedRuntimes" :key="runtime.id">
                    <td>{{ runtime.name }}</td>
                    <td><span class="role-tag">{{ runtime.role }}</span></td>
                    <td><code>{{ modelLabel(runtime) }}</code></td>
                    <td>
                      <span class="effort-tag">{{ runtime.effort || 'default' }}</span>
                    </td>
                    <td>
                      <span :class="['status-badge', `runtime-status-${runtime.status}`]">
                        {{ runtime.status }}
                      </span>
                    </td>
                    <td>{{ formatDateTime(runtime.last_seen_at) }}</td>
                    <td v-if="canCreateGrant && canManageNode(node)" class="runtime-actions">
                      <VButton
                        v-if="runtime.status === 'running'"
                        variant="secondary"
                        size="small"
                        :loading="isBusy('runtime', runtime.id)"
                        @click="onRuntimeStatus(runtime, 'draining')"
                      >
                        Drain runtime
                      </VButton>
                      <VButton
                        v-if="runtime.status === 'running' || runtime.status === 'pending'"
                        variant="ghost"
                        size="small"
                        :loading="isBusy('runtime', runtime.id)"
                        @click="onRuntimeStatus(runtime, 'stopped')"
                      >
                        Stop runtime
                      </VButton>
                      <VButton
                        v-if="runtime.status !== 'running'"
                        variant="secondary"
                        size="small"
                        :loading="isBusy('runtime', runtime.id)"
                        @click="onRuntimeStatus(runtime, 'running')"
                      >
                        Start runtime
                      </VButton>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p v-else class="empty-inline">No runtimes declared on this node.</p>
            </section>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.agent-list {
  padding: 1.5rem;
  max-width: 1200px;
  margin: 0 auto;
}

.header-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}

.agent-list h1 {
  margin: 0 0 0.25rem 0;
  font-size: 24px;
  color: #1f2937;
}

.page-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
  color: #6b7280;
}

.error {
  color: #ef4444;
}

.action-error {
  padding: 12px 16px;
  margin-bottom: 1rem;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

.inline-error {
  padding: 0;
  margin-top: 8px;
  text-align: left;
}

.node-list {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.node-card {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.node-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  padding: 16px;
  flex-wrap: wrap;
}

.node-summary {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 240px;
  padding: 0;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  color: inherit;
}

.node-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.node-name {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.node-meta {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  font-size: 13px;
  color: #6b7280;
}

.node-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.node-detail {
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.detail-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.section-header h2 {
  margin: 0;
  font-size: 16px;
  color: #1f2937;
}

.count {
  padding: 1px 8px;
  background: #e5e7eb;
  color: #374151;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
}

.agent-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
  display: block;
  overflow-x: auto;
}

.agent-table th,
.agent-table td {
  padding: 10px 12px;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
  white-space: nowrap;
}

.agent-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.agent-table code {
  font-size: 12px;
  color: #374151;
}

.status-badge,
.role-tag,
.effort-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.82em;
  font-weight: 500;
  line-height: 1.5;
}

.status-active,
.runtime-status-running {
  background: #d1fae5;
  color: #065f46;
}

.status-draining,
.runtime-status-draining,
.runtime-status-pending {
  background: #fef3c7;
  color: #92400e;
}

.status-revoked,
.runtime-status-stopped {
  background: #fee2e2;
  color: #991b1b;
}

.role-tag {
  background: #e0e7ff;
  color: #3730a3;
  margin: 0 4px 2px 0;
}

.effort-tag {
  background: #f3e8ff;
  color: #6b21a8;
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #6b7280;
}

.empty-hint {
  color: #9ca3af;
  font-size: 14px;
  margin-top: 4px;
}

.empty-inline {
  margin: 0 0 12px;
  color: #9ca3af;
  font-size: 14px;
}

.loading-inline {
  padding: 12px 0;
  color: #6b7280;
  font-size: 14px;
}

.grant-form {
  display: flex;
  align-items: flex-end;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #f3f4f6;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: #4b5563;
}

.form-group select {
  min-width: 160px;
  padding: 8px 10px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  background: white;
}

.runtime-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.link-details {
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}

.link-details:hover {
  text-decoration: underline;
}

@media (max-width: 640px) {
  .agent-list {
    padding: 1rem;
  }

  .node-header {
    align-items: stretch;
    flex-direction: column;
  }

  .node-actions {
    justify-content: flex-start;
  }
}

.header-actions {
  display: flex;
  gap: 0.5rem;
  align-items: center;
}

.mint-panel {
  border: 1px solid var(--color-border, #d0d7de);
  border-radius: 8px;
  padding: 1rem;
  margin-bottom: 1rem;
  background: var(--color-surface, #fff);
}

.mint-panel .form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  align-items: end;
}

.mint-panel label {
  display: block;
  font-size: 0.85rem;
}

.mint-panel input {
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--color-border, #d0d7de);
  border-radius: 4px;
}

.minted-token code {
  display: block;
  overflow-wrap: anywhere;
  padding: 0.5rem;
  background: #f6f8fa;
  border-radius: 4px;
}
</style>
