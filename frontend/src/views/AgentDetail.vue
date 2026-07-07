<script setup>
import { ref, onMounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchAgentDetail } from '@/api/agents'
import { useAuthStore } from '@/stores/auth'
import { deleteAgent, revokeAgentKey } from '@/api/agents'

const route = useRoute()
const agent = ref(null)
const loading = ref(true)
const error = ref(null)
const authStore = useAuthStore()
const router = useRouter()
const showRevokeConfirm = ref(false)
const showDeleteConfirm = ref(false)
const actionLoading = ref(false)
const actionError = ref(null)

const canRevoke = computed(() => authStore.user.value?.role === 'super_admin')
const canDelete = computed(() => {
  const role = authStore.user.value?.role
  return role === 'super_admin' || role === 'project_admin'
})

onMounted(async () => {
  try {
    const data = await fetchAgentDetail(route.params.id)
    agent.value = data
  } catch (err) {
    console.error('Failed to load agent detail:', err)
    error.value = 'Failed to load agent detail'
  } finally {
    loading.value = false
  }
})

function formatCost(cost) {
  return `$${Number(cost || 0).toFixed(2)}`
}

function formatDate(dateStr) {
  return dateStr ? new Date(dateStr).toLocaleString() : '—'
}

async function handleRevoke() {
  actionLoading.value = true
  actionError.value = null
  try {
    const agentId = agent.value.agent_id || agent.value.id
    await revokeAgentKey(agentId)
    showRevokeConfirm.value = false
    const data = await fetchAgentDetail(route.params.id)
    agent.value = data
  } catch (err) {
    actionError.value = err.message || 'Failed to revoke API key'
  } finally {
    actionLoading.value = false
  }
}

async function handleDelete() {
  actionLoading.value = true
  actionError.value = null
  try {
    const agentId = agent.value.agent_id || agent.value.id
    await deleteAgent(agentId)
    router.push('/agents')
  } catch (err) {
    actionError.value = err.message || 'Failed to delete agent'
  } finally {
    actionLoading.value = false
  }
}
</script>

<template>
  <div class="agent-detail">
    <div v-if="loading" class="loading">Loading...</div>
    <div v-else-if="error" class="error">{{ error }}</div>
    <div v-else-if="agent" class="detail-content">
      <div class="detail-header">
        <h1>{{ agent.agent_name || agent.name || 'Agent ' + agent.agent_id }}</h1>
        <span :class="['status-badge', 'status-' + agent.status]">
          {{ agent.status }}
        </span>
      </div>

      <div class="stats-row">
        <div class="stat">
          <label>Total Actions</label>
          <span>{{ agent.totalActions || 0 }}</span>
        </div>
        <div class="stat">
          <label>Total Cost</label>
          <span>{{ formatCost(agent.totalCost) }}</span>
        </div>
        <div class="stat">
          <label>Current Step</label>
          <span>{{ agent.current_step || '—' }}</span>
        </div>
        <div class="stat">
          <label>Last Seen</label>
          <span>{{ formatDate(agent.last_seen) }}</span>
        </div>
      </div>

      <div v-if="agent.current_ticket_id" class="current-ticket">
        <h3>Current Ticket</h3>
        <p>{{ agent.current_ticket_title || agent.current_ticket_id }}</p>
      </div>

      <div v-if="agent.history && agent.history.length > 0" class="history-section">
        <h2>Action History</h2>
        <table class="history-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="action in agent.history" :key="action.id">
              <td>{{ formatDate(action.created_at) }}</td>
              <td>{{ action.action_type }}</td>
              <td>{{ formatCost(action.cost_incurred) }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="canRevoke || canDelete" class="actions-section">
        <h2>Actions</h2>
        <div class="actions-buttons">
          <button v-if="canRevoke" class="btn-danger-outline" @click="showRevokeConfirm = true" :disabled="actionLoading">
            Revoke API Key
          </button>
          <button v-if="canDelete" class="btn-danger" @click="showDeleteConfirm = true" :disabled="actionLoading">
            Delete Agent
          </button>
        </div>
        <div v-if="actionError" class="error">{{ actionError }}</div>
      </div>

      <div v-if="showRevokeConfirm" class="modal-overlay" @click.self="showRevokeConfirm = false">
        <div class="modal modal-sm">
          <h3>Revoke API Key</h3>
          <p>Are you sure you want to revoke the API key for <strong>{{ agent.agent_name || agent.name }}</strong>? The agent will no longer be able to make API calls.</p>
          <div class="modal-actions">
            <button class="btn-danger" @click="handleRevoke" :disabled="actionLoading">
              {{ actionLoading ? 'Revoking...' : 'Revoke' }}
            </button>
            <button class="btn-cancel" @click="showRevokeConfirm = false" :disabled="actionLoading">Cancel</button>
          </div>
        </div>
      </div>

      <div v-if="showDeleteConfirm" class="modal-overlay" @click.self="showDeleteConfirm = false">
        <div class="modal modal-sm">
          <h3>Delete Agent</h3>
          <p>Are you sure you want to delete <strong>{{ agent.agent_name || agent.name }}</strong>? This action cannot be undone.</p>
          <div class="modal-actions">
            <button class="btn-danger" @click="handleDelete" :disabled="actionLoading">
              {{ actionLoading ? 'Deleting...' : 'Delete' }}
            </button>
            <button class="btn-cancel" @click="showDeleteConfirm = false" :disabled="actionLoading">Cancel</button>
          </div>
        </div>
      </div>

      <router-link to="/agents" class="back-link">← Back to Agents</router-link>
    </div>
  </div>
</template>

<style scoped>
.agent-detail {
  padding: 1.5rem;
  max-width: 900px;
  margin: 0 auto;
}

.loading, .error {
  padding: 40px 20px;
  text-align: center;
}

.error {
  color: #ef4444;
}

.detail-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.5rem;
}

.detail-header h1 {
  margin: 0;
  font-size: 24px;
  color: #1f2937;
}

.status-badge {
  padding: 4px 12px;
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

.stats-row {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 16px;
  margin-bottom: 1.5rem;
}

.stat {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
}

.stat label {
  display: block;
  font-size: 0.85em;
  color: #6b7280;
  margin-bottom: 4px;
}

.stat span {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.current-ticket {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 1.5rem;
}

.current-ticket h3 {
  margin: 0 0 8px 0;
  font-size: 14px;
  color: #6b7280;
}

.current-ticket p {
  margin: 0;
  color: #1f2937;
}

.history-section {
  margin-bottom: 1.5rem;
}

.history-section h2 {
  font-size: 18px;
  color: #1f2937;
  margin: 0 0 1rem 0;
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  overflow: hidden;
}

.history-table th,
.history-table td {
  padding: 10px 16px;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}

.history-table th {
  background: #f9fafb;
  font-weight: 600;
  color: #374151;
  font-size: 13px;
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

.actions-section {
  margin-bottom: 1.5rem;
}

.actions-section h2 {
  font-size: 18px;
  color: #1f2937;
  margin: 0 0 1rem 0;
}

.actions-buttons {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.btn-danger {
  padding: 8px 16px;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-danger:hover:not(:disabled) {
  background: #dc2626;
}

.btn-danger:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-danger-outline {
  padding: 8px 16px;
  background: white;
  color: #ef4444;
  border: 1px solid #ef4444;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-danger-outline:hover:not(:disabled) {
  background: #fef2f2;
}

.btn-danger-outline:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  background: white;
  border-radius: 8px;
  padding: 24px;
  width: 100%;
  max-width: 400px;
}

.modal-sm {
  max-width: 400px;
}

.modal h3 {
  margin: 0 0 12px;
  font-size: 18px;
  color: #1f2937;
}

.modal p {
  margin: 0 0 20px;
  color: #374151;
  font-size: 14px;
  line-height: 1.5;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
}

.btn-cancel {
  padding: 8px 16px;
  background: white;
  color: #374151;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-cancel:hover:not(:disabled) {
  background: #f9fafb;
}

.btn-cancel:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
