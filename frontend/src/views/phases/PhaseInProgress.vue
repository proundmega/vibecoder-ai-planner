<script setup>
import { ref } from 'vue'
import { post } from '@/api/client'

const props = defineProps({
  phaseData: { type: Object, required: true },
  ticketId: { type: String, required: true },
  projectId: { type: String, required: true },
})

const emit = defineEmits(['transition', 'back'])

const activeTab = ref('feed')
const feedbackText = ref('')
const submitting = ref(false)
const requestingReview = ref(false)
const error = ref('')

const tabs = [
  { key: 'feed', label: 'Status Feed' },
  { key: 'feedback', label: 'Feedback' },
]

const statusEntries = [
  { time: 'Just now', message: 'Agent started working on this ticket', type: 'info' },
  { time: 'Just now', message: 'Cloning repository...', type: 'info' },
]

const feedbackEntries = ref([])

async function sendFeedback() {
  if (!feedbackText.value.trim()) return
  submitting.value = true
  try {
    const response = await post(`/api/v1/tickets/${props.ticketId}/messages`, {
      messageType: 'feedback',
      content: feedbackText.value.trim(),
    })
    if (response) {
      feedbackEntries.value.push({
        content: feedbackText.value.trim(),
        created_at: new Date().toISOString(),
        from_user: true,
      })
    }
    feedbackText.value = ''
  } catch (e) {
    error.value = e.message || 'Failed to send feedback'
  } finally {
    submitting.value = false
  }
}

async function handleRequestReview() {
  error.value = ''
  requestingReview.value = true
  try {
    emit('transition', 'review')
  } catch (e) {
    error.value = e.message || 'Failed to request review'
  } finally {
    requestingReview.value = false
  }
}
</script>

<template>
  <div class="phase-in-progress">
    <h2>In Progress</h2>
    <p class="phase-description">
      Monitor the agent's progress and provide feedback.
    </p>

    <div v-if="error" class="error-banner">{{ error }}</div>

    <!-- Tabs -->
    <div class="tabs">
      <button
        v-for="tab in tabs"
        :key="tab.key"
        @click="activeTab = tab.key"
        :class="['tab', { active: activeTab === tab.key }]"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- Status Feed -->
    <div v-if="activeTab === 'feed'" class="tab-content">
      <div class="status-feed">
        <div
          v-for="(entry, idx) in statusEntries"
          :key="idx"
          class="status-entry"
          :class="entry.type"
        >
          <div class="status-dot"></div>
          <div class="status-text">
            <p>{{ entry.message }}</p>
            <span class="status-time">{{ entry.time }}</span>
          </div>
        </div>
        <div class="status-placeholder">
          <p>Agent activity will appear here in real-time.</p>
        </div>
      </div>
    </div>

    <!-- Feedback -->
    <div v-else-if="activeTab === 'feedback'" class="tab-content">
      <div class="feedback-list">
        <div
          v-for="(fb, idx) in feedbackEntries"
          :key="idx"
          class="feedback-item"
          :class="{ 'my-feedback': fb.from_user }"
        >
          <div class="feedback-bubble">{{ fb.content }}</div>
          <span class="feedback-time">{{ new Date(fb.created_at).toLocaleTimeString() }}</span>
        </div>
        <div v-if="feedbackEntries.length === 0" class="empty-feedback">
          <p>No feedback yet. Send a message to the agent.</p>
        </div>
      </div>

      <div class="feedback-input">
        <textarea
          v-model="feedbackText"
          rows="3"
          placeholder="Type a message to the agent..."
          @keyup.enter.ctrl="sendFeedback"
        ></textarea>
        <button @click="sendFeedback" :disabled="submitting || !feedbackText.trim()" class="btn-send">
          {{ submitting ? 'Sending...' : 'Send' }}
        </button>
      </div>
    </div>

    <div class="form-actions">
      <button @click="emit('back')" class="btn-secondary">Back</button>
      <button @click="handleRequestReview" :disabled="requestingReview" class="btn-primary">
        {{ requestingReview ? 'Requesting...' : 'Request Review' }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.phase-in-progress {
  max-width: 700px;
}

.phase-in-progress h2 {
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

.tabs {
  display: flex;
  gap: 4px;
  margin-bottom: 20px;
  border-bottom: 2px solid #e5e7eb;
}

.tab {
  padding: 10px 20px;
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  cursor: pointer;
  font-size: 14px;
  color: #6b7280;
  transition: all 0.2s;
}

.tab:hover {
  color: #3b82f6;
}

.tab.active {
  color: #3b82f6;
  border-bottom-color: #3b82f6;
  font-weight: 500;
}

.tab-content {
  min-height: 200px;
}

.status-feed {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.status-entry {
  display: flex;
  gap: 12px;
}

.status-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #3b82f6;
  margin-top: 5px;
  flex-shrink: 0;
}

.status-text p {
  margin: 0 0 4px;
  color: #374151;
}

.status-time {
  font-size: 12px;
  color: #9ca3af;
}

.status-placeholder {
  text-align: center;
  padding: 24px;
  color: #9ca3af;
  font-style: italic;
}

.feedback-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
  max-height: 300px;
  overflow-y: auto;
}

.feedback-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.feedback-item.my-feedback {
  align-items: flex-end;
}

.feedback-bubble {
  padding: 10px 14px;
  background: #f3f4f6;
  border-radius: 12px;
  max-width: 80%;
  font-size: 14px;
  color: #374151;
}

.feedback-item.my-feedback .feedback-bubble {
  background: #3b82f6;
  color: white;
}

.feedback-time {
  font-size: 11px;
  color: #9ca3af;
}

.empty-feedback {
  text-align: center;
  padding: 24px;
  color: #9ca3af;
}

.feedback-input {
  display: flex;
  gap: 8px;
}

.feedback-input textarea {
  flex: 1;
  padding: 10px 12px;
  border: 1px solid #d1d5db;
  border-radius: 6px;
  font-size: 14px;
  font-family: inherit;
  resize: none;
}

.feedback-input textarea:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.btn-send {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  white-space: nowrap;
}

.btn-send:hover:not(:disabled) {
  background: #2563eb;
}

.btn-send:disabled {
  background: #9ca3af;
  cursor: not-allowed;
}

.form-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 24px;
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
