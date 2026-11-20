<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import {
  drainAgentNode,
  listAgentNodes,
  revokeAgentNode,
  updateAgentRuntime,
  type AgentNode,
  type AgentRuntime,
  type AgentRuntimeStatus,
} from '@/api/agentNodes'
import { useAuthStore } from '@/stores/auth'
import VButton from '@/components/VButton.vue'

const route = useRoute()
const authStore = useAuthStore()

const nodes = ref<AgentNode[]>([])
const loading = ref(true)
const error = ref('')
const actionError = ref('')
const busy = ref(false)

const routeId = computed(() => String(route.params.id))

const runtimeMatch = computed<{ node: AgentNode; runtime: AgentRuntime } | null>(() => {
  for (const node of nodes.value) {
    for (const runtime of node.runtimes ?? []) {
      if (String(runtime.id) === routeId.value) return { node, runtime }
    }
  }
  return null
})

const nodeMatch = computed<AgentNode | null>(
  () => nodes.value.find(node => String(node.id) === routeId.value) ?? null
)

const displayTitle = computed(
  () => runtimeMatch.value?.runtime.name || nodeMatch.value?.name || `Runtime ${routeId.value}`
)

const status = computed(() => {
  if (runtimeMatch.value) return runtimeMatch.value.runtime.status
  if (nodeMatch.value) return nodeMatch.value.status
  return 'unknown'
})

const canManageRuntimes = computed(() => authStore.hasAnyPermission(['AGENT_CREATE']))
const canManageNodes = computed(() => authStore.hasAnyPermission(['AGENT_REVOKE']))

function formatDateTime(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : 'Never'
}

async function loadFleet(): Promise<void> {
  try {
    nodes.value = (await listAgentNodes()) || []
    error.value = ''
  } catch (err) {
    error.value = (err as Error).message || 'Failed to load the runtime record'
  } finally {
    loading.value = false
  }
}

async function setRuntimeStatus(nextStatus: AgentRuntimeStatus): Promise<void> {
  const target = runtimeMatch.value?.runtime
  if (!target) return
  busy.value = true
  actionError.value = ''
  try {
    await updateAgentRuntime(target.id, { status: nextStatus })
    await loadFleet()
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to update the runtime'
  } finally {
    busy.value = false
  }
}

async function onDrainNode(): Promise<void> {
  const node = nodeMatch.value
  if (!node) return
  busy.value = true
  actionError.value = ''
  try {
    await drainAgentNode(node.id)
    await loadFleet()
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to drain the node'
  } finally {
    busy.value = false
  }
}

async function onRevokeNode(): Promise<void> {
  const node = nodeMatch.value
  if (!node) return
  busy.value = true
  actionError.value = ''
  try {
    await revokeAgentNode(node.id)
    await loadFleet()
  } catch (err) {
    actionError.value = (err as Error).message || 'Failed to revoke the node'
  } finally {
    busy.value = false
  }
}

onMounted(loadFleet)
</script>

<template>
  <div class="agent-detail">
    <div v-if="loading" class="loading">Loading runtime record...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else class="detail-content">
      <div class="detail-header">
        <div>
          <h1>{{ displayTitle }}</h1>
          <p class="page-subtitle">
            Runtime and node state comes from the agent fleet. There is no retrievable agent key.
          </p>
        </div>
        <span :class="['status-badge', `status-${status}`]">{{ status }}</span>
      </div>

      <div v-if="actionError" class="error action-error">{{ actionError }}</div>

      <div v-if="runtimeMatch" class="details-section">
        <h2>Runtime</h2>
        <dl class="details-grid">
          <div>
            <dt>Runtime ID</dt>
            <dd>{{ runtimeMatch.runtime.id }}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{{ runtimeMatch.runtime.name }}</dd>
          </div>
          <div>
            <dt>Role</dt>
            <dd><span class="role-tag">{{ runtimeMatch.runtime.role }}</span></dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd><code>{{ runtimeMatch.runtime.model_ref || runtimeMatch.runtime.model_id }}</code></dd>
          </div>
          <div>
            <dt>Effort</dt>
            <dd>
              <span class="effort-tag">{{ runtimeMatch.runtime.effort || 'model default' }}</span>
            </dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{{ runtimeMatch.runtime.status }}</dd>
          </div>
          <div>
            <dt>Concurrency</dt>
            <dd>{{ runtimeMatch.runtime.concurrency }}</dd>
          </div>
          <div>
            <dt>Node</dt>
            <dd>{{ runtimeMatch.node.name }} ({{ runtimeMatch.node.id }})</dd>
          </div>
          <div>
            <dt>Current project</dt>
            <dd>{{ runtimeMatch.runtime.current_project_id || '—' }}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{{ formatDateTime(runtimeMatch.runtime.last_seen_at) }}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{{ formatDateTime(runtimeMatch.runtime.created_at) }}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{{ formatDateTime(runtimeMatch.runtime.updated_at) }}</dd>
          </div>
        </dl>

        <div v-if="canManageRuntimes" class="runtime-actions">
          <VButton
            v-if="runtimeMatch.runtime.status === 'running'"
            variant="secondary"
            :loading="busy"
            @click="setRuntimeStatus('draining')"
          >
            Drain runtime
          </VButton>
          <VButton
            v-if="runtimeMatch.runtime.status === 'running' || runtimeMatch.runtime.status === 'pending'"
            variant="ghost"
            :loading="busy"
            @click="setRuntimeStatus('stopped')"
          >
            Stop runtime
          </VButton>
          <VButton
            v-if="runtimeMatch.runtime.status !== 'running'"
            variant="secondary"
            :loading="busy"
            @click="setRuntimeStatus('running')"
          >
            Start runtime
          </VButton>
        </div>
      </div>

      <div v-else-if="nodeMatch" class="details-section">
        <h2>Node</h2>
        <dl class="details-grid">
          <div>
            <dt>Node ID</dt>
            <dd>{{ nodeMatch.id }}</dd>
          </div>
          <div>
            <dt>Name</dt>
            <dd>{{ nodeMatch.name }}</dd>
          </div>
          <div>
            <dt>Owner</dt>
            <dd>{{ nodeMatch.owner_name || nodeMatch.owner_id }}</dd>
          </div>
          <div>
            <dt>Hostname</dt>
            <dd>{{ nodeMatch.hostname || '—' }}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{{ nodeMatch.status }}</dd>
          </div>
          <div>
            <dt>Last seen</dt>
            <dd>{{ formatDateTime(nodeMatch.last_seen_at) }}</dd>
          </div>
          <div>
            <dt>Runtimes</dt>
            <dd>{{ nodeMatch.runtimes?.length ?? 0 }}</dd>
          </div>
          <div>
            <dt>Grants</dt>
            <dd>{{ nodeMatch.grants?.length ?? 0 }}</dd>
          </div>
        </dl>

        <div v-if="canManageNodes" class="runtime-actions">
          <VButton
            v-if="nodeMatch.status === 'active'"
            variant="secondary"
            :loading="busy"
            @click="onDrainNode"
          >
            Drain node
          </VButton>
          <VButton
            v-if="nodeMatch.status !== 'revoked'"
            variant="danger"
            :loading="busy"
            @click="onRevokeNode"
          >
            Revoke node
          </VButton>
        </div>
      </div>

      <div v-else class="details-section">
        <h2>Runtime record</h2>
        <p class="unresolved">
          Runtime {{ routeId }} is not visible in the fleet for this account. It may have been
          removed, revoked, or it may belong to another owner.
        </p>
        <dl class="details-grid">
          <div>
            <dt>Runtime ID</dt>
            <dd>{{ routeId }}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>Unknown</dd>
          </div>
        </dl>
      </div>

      <router-link to="/agents" class="back-link">← Back to fleet</router-link>
    </div>
  </div>
</template>

<style scoped>
.agent-detail {
  padding: 1.5rem;
  max-width: 900px;
  margin: 0 auto;
}

.loading,
.error {
  padding: 40px 20px;
  text-align: center;
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

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 1.5rem;
  flex-wrap: wrap;
}

.detail-header h1 {
  margin: 0 0 4px;
  font-size: 24px;
  color: #1f2937;
}

.page-subtitle {
  margin: 0;
  color: #6b7280;
  font-size: 14px;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 12px;
  font-size: 0.85em;
  font-weight: 500;
}

.status-active,
.status-running {
  background: #d1fae5;
  color: #065f46;
}

.status-draining,
.status-pending {
  background: #fef3c7;
  color: #92400e;
}

.status-revoked,
.status-stopped {
  background: #fee2e2;
  color: #991b1b;
}

.status-unknown {
  background: #e5e7eb;
  color: #374151;
}

.details-section {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 1.5rem;
}

.details-section h2 {
  margin: 0 0 12px;
  font-size: 18px;
  color: #1f2937;
}

.details-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 12px 20px;
  margin: 0;
}

.details-grid div {
  min-width: 0;
}

.details-grid dt {
  margin-bottom: 2px;
  font-size: 0.8em;
  color: #6b7280;
}

.details-grid dd {
  margin: 0;
  color: #1f2937;
  font-weight: 500;
  word-break: break-word;
}

.details-grid code {
  font-size: 12px;
}

.role-tag,
.effort-tag {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 12px;
  font-size: 0.82em;
  font-weight: 500;
}

.role-tag {
  background: #e0e7ff;
  color: #3730a3;
}

.effort-tag {
  background: #f3e8ff;
  color: #6b21a8;
}

.runtime-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #f3f4f6;
}

.unresolved {
  margin: 0 0 16px;
  color: #6b7280;
  line-height: 1.5;
}

.back-link {
  display: inline-block;
  color: #3b82f6;
  text-decoration: none;
  font-size: 14px;
}

.back-link:hover {
  text-decoration: underline;
}
</style>
