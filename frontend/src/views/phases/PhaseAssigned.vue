<script setup>
import { ref, onMounted } from 'vue'
import { get } from '@/api/client'

defineProps({
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const agents = ref([])
const selectedAgentId = ref(null)
const autoAssign = ref(false)
const loading = ref(true)
const error = ref('')
const assigning = ref(false)

onMounted(async () => {
  try {
    const response = await get('/api/v1/agents')
    agents.value = response || []
  } catch (e) {
    console.error('Failed to load agents:', e)
    error.value = 'Failed to load agents. Please check your connection and try again.'
    agents.value = []
  } finally {
    loading.value = false
  }
})

function getStatusColor(status) {
  const colors = {
    online: 'green',
    idle: '#f59e0b',
    offline: '#ef4444',
  }
  return colors[status] || '#9ca3af'
}

function handleAssign() {
  if (autoAssign.value) {
    const available = agents.value.find(a => a.status === 'idle' || a.status === 'online')
    if (available) {
      selectedAgentId.value = available.id
    }
  }

  if (!selectedAgentId.value) {
    error.value = 'Please select an agent or enable auto-assign'
    return
  }

  error.value = ''
  assigning.value = true
  try {
    emit('transition', 'in_progress', { agentId: selectedAgentId.value })
  } catch (e) {
    error.value = e.message || 'Assignment failed'
  } finally {
    assigning.value = false
  }
}
</script>

<template>
  <div class="phase-assigned">
    <h2>Assigned Phase</h2>
    <p class="phase-description">
      Select an agent to work on this ticket, or enable auto-assign.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <div class="auto-assign">
      <label class="checkbox-label">
        <input type="checkbox" v-model="autoAssign" />
        Auto-assign to available agent
      </label>
    </div>

    <div v-if="loading" class="loading-state">Loading agents...</div>

    <div v-else class="agent-list">
      <div
        v-if="agents.length === 0"
        class="no-agents"
      >
        <p>No agents available. Please try again later.</p>
      </div>

      <div
        v-for="agent in agents"
        :key="agent.id"
        @click="!autoAssign && (selectedAgentId = agent.id)"
        :class="['agent-card', { selected: selectedAgentId === agent.id }]"
      >
        <div class="agent-avatar">
          <span class="avatar-letter">{{ agent.name?.[0] || '?' }}</span>
        </div>
        <div class="agent-info">
          <h4>{{ agent.name || 'Unknown Agent' }}</h4>
          <span
            class="status-badge"
            :style="{ backgroundColor: getStatusColor(agent.status) }"
          >
            {{ agent.status }}
          </span>
          <div v-if="agent.cpu_usage" class="agent-stats">
            CPU: {{ agent.cpu_usage }} | Memory: {{ agent.memory_usage || 'N/A' }}
          </div>
        </div>
        <div v-if="selectedAgentId === agent.id" class="check-mark">&#10003;</div>
      </div>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back</button>
      <button @click="handleAssign" :disabled="assigning" class="btn-primary">
        {{ assigning ? 'Assigning...' : 'Assign & Start Work' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-assigned {
  max-width: 600px;
}

.phase-assigned h2 {
  margin: 0 0 8px;
  color: #1f2937;
}

.phase-description {
  color: #6b7280;
  margin-bottom: 24px;
}

.error-banner {
  padding: 12px 16px;
  background: #fee2e2;
  color: #991b1b;
  border-radius: 6px;
  margin-bottom: 20px;
  font-size: 14px;
}

.auto-assign {
  margin-bottom: 20px;
  padding: 12px 16px;
  background: #eff6ff;
  border-radius: 6px;
  border: 1px solid #bfdbfe;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #1e40af;
}

.agent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 24px;
}

.no-agents {
  text-align: center;
  padding: 24px;
  color: #9ca3af;
}

.agent-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.agent-card:hover {
  border-color: #3b82f6;
  background: #f9fafb;
}

.agent-card.selected {
  border-color: #3b82f6;
  background: #eff6ff;
}

.agent-avatar {
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: #3b82f6;
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar-letter {
  color: white;
  font-weight: 600;
  font-size: 16px;
}

.agent-info {
  flex: 1;
}

.agent-info h4 {
  margin: 0 0 4px;
  font-size: 14px;
  color: #1f2937;
}

.status-badge {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
  color: white;
  text-transform: capitalize;
}

.agent-stats {
  font-size: 12px;
  color: #6b7280;
  margin-top: 4px;
}

.check-mark {
  color: #3b82f6;
  font-size: 20px;
  font-weight: bold;
}

.loading-state {
  text-align: center;
  padding: 24px;
  color: #6b7280;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.btn-primary {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.btn-primary:hover:not(:disabled) {
  background: #2563eb;
}

.btn-primary:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 10px 20px;
  background: white;
  color: #6b7280;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.btn-secondary:hover {
  background: #f9fafb;
}
</style>
