<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { fetchAgentDetail } from '@/api/agents'

const route = useRoute()
const agent = ref(null)
const loading = ref(true)
const error = ref(null)

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
</style>
