<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useRouter } from 'vue-router'
import { fetchAgentStatusList } from '@/api/agents'
import { createAgent } from '@/api/agents'
import AgentModal from '@/components/AgentModal.vue'

const agents = ref([])
const loading = ref(true)
const error = ref(null)
const showCreateModal = ref(false)
const createError = ref(null)
const router = useRouter()
let pollInterval = null

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

onMounted(() => {
  loadAgents()
  pollInterval = setInterval(loadAgents, 10000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
})

function viewDetail(agentId) {
  router.push(`/agents/${agentId}`)
}

function statusClass(status) {
  return { online: 'status-online', idle: 'status-idle', offline: 'status-offline' }[status] || 'status-offline'
}

function formatCost(cost) {
  return `$${Number(cost || 0).toFixed(2)}`
}

async function handleCreate(name) {
  try {
    await createAgent(name)
    showCreateModal.value = false
    createError.value = null
  } catch (err) {
    createError.value = err.message || 'Failed to create agent'
  }
}
</script>

<template>
  <div class="agent-list">
    <div class="header-row">
      <h1>Agents</h1>
      <button class="btn-primary" @click="showCreateModal = true">
        Create Agent
      </button>
    </div>
    <AgentModal v-model:show="showCreateModal" @created="handleCreate" />
    <div v-if="createError" class="error">{{ createError }}</div>
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
        <p>No agents found.</p>
        <p class="empty-hint">Click "Create Agent" to get started.</p>
      </div>
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
</style>
