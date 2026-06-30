<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fetchPhases, fetchAllowedPhases, transitionPhase } from '@/api/phases'

const route = useRoute()
const router = useRouter()
const ticketId = computed(() => route.params.ticketId)
const projectId = computed(() => route.params.id)

const loading = ref(true)
const error = ref(null)
const currentPhase = ref('draft')
const allowedTransitions = ref([])
const phaseHistory = ref([])
const transitioning = ref(false)

const phaseComponents = {}

const phaseLabels = {
  draft: 'Draft',
  planning: 'Planning',
  plan_approved: 'Plan Approved',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  review: 'Review',
  human_approval: 'Human Approval',
  done: 'Done',
  deployed: 'Deployed',
}

const phaseOrder = [
  'draft', 'planning', 'plan_approved', 'assigned',
  'in_progress', 'blocked', 'review', 'human_approval', 'done', 'deployed',
]

const currentPhaseIndex = computed(() => {
  return phaseOrder.indexOf(currentPhase.value)
})

const phaseProgress = computed(() => {
  return ((currentPhaseIndex.value + 1) / phaseOrder.length) * 100
})

async function loadPhaseData() {
  loading.value = true
  error.value = null
  try {
    const [phaseRes, allowedRes, historyRes] = await Promise.allSettled([
      fetchPhases(ticketId.value),
      fetchAllowedPhases(ticketId.value),
      fetchPhaseHistory(ticketId.value),
    ])

    if (phaseRes.status === 'fulfilled') {
      currentPhase.value = phaseRes.value.phase || 'draft'
    }
    if (allowedRes.status === 'fulfilled') {
      allowedTransitions.value = allowedRes.value.allowed || []
    }
    if (historyRes.status === 'fulfilled') {
      phaseHistory.value = historyRes.value || []
    }

    const errors = [phaseRes, allowedRes, historyRes]
      .filter(r => r.status === 'rejected')
      .map(r => r.reason.message)

    if (errors.length > 0) {
      error.value = errors.join('; ')
    }
  } catch (e) {
    error.value = e.message || 'Failed to load phase data'
  } finally {
    loading.value = false
  }
}

async function handleTransition(targetPhase, metadata = {}) {
  if (transitioning.value) return
  transitioning.value = true
  error.value = null
  try {
    await transitionPhase(ticketId.value, targetPhase, metadata, 'human')
    await loadPhaseData()
  } catch (e) {
    error.value = e.message || 'Transition failed'
  } finally {
    transitioning.value = false
  }
}

onMounted(loadPhaseData)
</script>

<template>
  <div class="phase-flow-container">
    <div class="phase-flow-header">
      <button @click="router.push(`/projects/${projectId}/tickets`)" class="back-btn">
        &larr; Back to Board
      </button>
      <h1>Phase Flow</h1>
    </div>

    <!-- Progress bar -->
    <div class="phase-progress">
      <div class="progress-bar">
        <div class="progress-fill" :style="{ width: phaseProgress + '%' }"></div>
      </div>
      <span class="phase-label">
        {{ phaseLabels[currentPhase] || currentPhase }}
        ({{ currentPhaseIndex + 1 }}/{{ phaseOrder.length }})
      </span>
    </div>

    <!-- Phase history -->
    <div v-if="phaseHistory.length > 0" class="phase-history">
      <h3>Phase History</h3>
      <div class="history-list">
        <div
          v-for="(entry, idx) in phaseHistory"
          :key="idx"
          class="history-entry"
          :class="{ current: idx === phaseHistory.length - 1 }"
        >
          <span class="history-arrow" v-if="idx > 0">&#8594;</span>
          <span class="history-phase">{{ entry.to_phase }}</span>
          <span class="history-by">
            by {{ entry.actor_type }}
            <span class="history-time">{{ new Date(entry.created_at).toLocaleString() }}</span>
          </span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="loading-state">
      <div class="spinner"></div>
      <p>Loading phase data...</p>
    </div>

    <!-- Error -->
    <div v-else-if="error" class="error-state">
      <p class="error-message">{{ error }}</p>
      <button @click="loadPhaseData" class="retry-btn">Retry</button>
    </div>

    <!-- Phase content -->
    <div v-else class="phase-content">
      <component
        :is="phaseComponents[currentPhase] || 'div'"
        :phase-data="{ currentPhase, allowedTransitions, history: phaseHistory }"
        :ticket-id="ticketId"
        :project-id="projectId"
        @transition="handleTransition"
        @back="() => router.push(`/projects/${projectId}/tickets`)"
      />
    </div>
  </div>
</template>

<style scoped>
.phase-flow-container {
  max-width: 900px;
  margin: 0 auto;
  padding: 20px;
}

.phase-flow-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.phase-flow-header h1 {
  margin: 0;
  font-size: 24px;
  color: #1f2937;
}

.back-btn {
  padding: 8px 16px;
  background: #6b7280;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.back-btn:hover {
  background: #4b5563;
}

.phase-progress {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: #e5e7eb;
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.3s ease;
}

.phase-label {
  font-size: 13px;
  color: #6b7280;
  white-space: nowrap;
}

.phase-history {
  margin-bottom: 24px;
  padding: 16px;
  background: #f9fafb;
  border-radius: 8px;
}

.phase-history h3 {
  margin: 0 0 12px;
  font-size: 14px;
  color: #374151;
}

.history-list {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.history-entry {
  display: flex;
  align-items: center;
  gap: 4px;
}

.history-arrow {
  color: #9ca3af;
  font-size: 12px;
}

.history-phase {
  padding: 2px 8px;
  background: #e0e7ff;
  color: #3730a3;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
}

.history-entry.current .history-phase {
  background: #3b82f6;
  color: white;
}

.history-by {
  font-size: 11px;
  color: #9ca3af;
}

.history-time {
  margin-left: 4px;
}

.loading-state {
  text-align: center;
  padding: 60px 20px;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e5e7eb;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin: 0 auto 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.error-state {
  text-align: center;
  padding: 40px 20px;
}

.error-message {
  color: #ef4444;
  margin-bottom: 16px;
}

.retry-btn {
  padding: 8px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
}

.retry-btn:hover {
  background: #2563eb;
}

.phase-content {
  min-height: 300px;
}
</style>
